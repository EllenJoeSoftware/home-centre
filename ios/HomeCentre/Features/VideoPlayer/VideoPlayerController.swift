import AVFoundation
import Foundation

/// Owns the AVPlayer for one video session: picks the playback URL (direct vs HLS),
/// handles resume, reports progress every 10 s / on pause / on close, and drives the
/// custom WebVTT subtitle overlay (AVPlayer cannot side-load VTT for progressive files).
@MainActor
final class VideoPlayerController: ObservableObject {
    let item: MediaItem
    let player = AVPlayer()

    @Published private(set) var subtitleText: String?
    @Published private(set) var selectedSubtitleId: String?
    @Published private(set) var isLoadingSubtitles = false
    @Published var errorMessage: String?

    var onProgressReported: (@MainActor () -> Void)?

    private let api: APIClient
    private var source: PlaybackSource?
    private var cues: [SubtitleCue] = []
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var timeControlObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var reportTask: Task<Void, Never>?
    private var subtitleTask: Task<Void, Never>?
    private var lastReportedPosition: Double = -1
    private var didFinish = false
    private var isStopped = false

    static let reportInterval: UInt64 = 10

    init(item: MediaItem, api: APIClient) {
        self.item = item
        self.api = api
    }

    /// Absolute media position in seconds (adds the HLS start offset to player time).
    var mediaTime: Double {
        let t = player.currentTime().seconds
        return (source?.timeOffset ?? 0) + (t.isFinite ? max(t, 0) : 0)
    }

    // MARK: - Lifecycle

    func start(at position: Double?) {
        guard source == nil else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)

        let src = api.urls.playback(for: item, startAt: position)
        source = src
        let playerItem = AVPlayerItem(url: src.url)
        playerItem.preferredForwardBufferDuration = 10
        player.replaceCurrentItem(with: playerItem)

        if !src.isHLS, let position, position > 0 {
            player.seek(to: CMTime(seconds: position, preferredTimescale: 600),
                        toleranceBefore: .zero, toleranceAfter: .zero)
        }

        statusObservation = playerItem.observe(\.status, options: [.new]) { [weak self] observed, _ in
            let failed = observed.status == .failed
            let message = observed.error?.localizedDescription
            Task { @MainActor [weak self] in
                if failed { self?.errorMessage = message ?? "This video could not be played." }
            }
        }

        timeControlObservation = player.observe(\.timeControlStatus, options: [.old, .new]) { [weak self] p, change in
            let pausedNow = p.timeControlStatus == .paused && change.oldValue == .playing
            guard pausedNow else { return }
            Task { @MainActor [weak self] in self?.reportProgress() }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: playerItem, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.handleEnded() }
        }

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.updateSubtitle() }
        }

        reportTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.reportInterval * 1_000_000_000)
                guard !Task.isCancelled, let self else { return }
                if self.player.timeControlStatus == .playing { self.reportProgress() }
            }
        }

        player.play()
    }

    /// Idempotent: final progress report and teardown.
    func stop() {
        guard !isStopped else { return }
        isStopped = true
        if source != nil && !didFinish { reportProgress(force: true) }
        reportTask?.cancel()
        subtitleTask?.cancel()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        statusObservation?.invalidate()
        timeControlObservation?.invalidate()
        player.pause()
        player.replaceCurrentItem(with: nil)
    }

    private func handleEnded() {
        guard !didFinish else { return }
        didFinish = true
        let end = item.durationSec ?? mediaTime
        send(position: end, completed: true)
    }

    // MARK: - Progress

    func reportProgress(force: Bool = false) {
        guard source != nil, !didFinish else { return }
        let pos = mediaTime
        if !force && abs(pos - lastReportedPosition) < 1 { return }
        send(position: pos, completed: nil)
    }

    private func send(position: Double, completed: Bool?) {
        lastReportedPosition = position
        let api = api, id = item.id, callback = onProgressReported
        Task {
            do {
                try await api.reportProgress(id, positionSec: position, completed: completed)
                await MainActor.run { callback?() }
            } catch {
                // Best effort; next periodic report will retry.
            }
        }
    }

    // MARK: - Subtitles

    func selectSubtitle(_ id: String?) {
        subtitleTask?.cancel()
        selectedSubtitleId = id
        cues = []
        subtitleText = nil
        guard let id else { return }
        isLoadingSubtitles = true
        let api = api, itemId = item.id
        subtitleTask = Task { [weak self] in
            do {
                let vtt = try await api.subtitleText(itemId: itemId, subId: id)
                let parsed = VTTParser.parse(vtt)
                guard !Task.isCancelled, let self else { return }
                self.cues = parsed
                self.isLoadingSubtitles = false
                if parsed.isEmpty { self.errorMessage = "Subtitle file is empty or unreadable." }
                self.updateSubtitle()
            } catch {
                guard !Task.isCancelled, let self else { return }
                self.isLoadingSubtitles = false
                self.errorMessage = "Couldn't load subtitles: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
            }
        }
    }

    private func updateSubtitle() {
        guard !cues.isEmpty else {
            if subtitleText != nil { subtitleText = nil }
            return
        }
        let text = VTTParser.text(at: mediaTime, in: cues)
        if text != subtitleText { subtitleText = text }
    }
}
