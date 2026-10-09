import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// App-wide audio player with a queue, background playback, lock-screen / Control Center
/// metadata (MPNowPlayingInfoCenter) and remote commands (MPRemoteCommandCenter).
@MainActor
final class AudioPlayer: ObservableObject {
    @Published private(set) var queue: [MediaItem] = []
    @Published private(set) var currentIndex: Int = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var duration: Double = 0

    /// Set by RootView whenever the API client changes (login/logout).
    var api: APIClient?
    var onProgressReported: (@MainActor () -> Void)?

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var timeControlObservation: NSKeyValueObservation?
    private var artworkTask: Task<Void, Never>?
    private var artwork: MPMediaItemArtwork?
    private var remoteConfigured = false
    private var lastReportAt: Date = .distantPast

    init() {
        player.automaticallyWaitsToMinimizeStalling = true
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            let playing = p.timeControlStatus != .paused
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.isPlaying != playing {
                    self.isPlaying = playing
                    if !playing { self.reportProgress() }
                    self.updateNowPlaying()
                }
            }
        }
    }

    var current: MediaItem? { queue.indices.contains(currentIndex) ? queue[currentIndex] : nil }
    var hasNext: Bool { currentIndex + 1 < queue.count }
    var hasPrevious: Bool { currentIndex > 0 }

    // MARK: - Queue control

    func play(queue items: [MediaItem], startIndex: Int) {
        let audio = items.filter { $0.kind == .audio }
        guard !audio.isEmpty else { return }
        // Map the start index onto the filtered list.
        let target = items.indices.contains(startIndex) ? items[startIndex].id : audio[0].id
        queue = audio
        currentIndex = audio.firstIndex { $0.id == target } ?? 0
        configureSessionAndRemote()
        loadCurrent(autoplay: true)
    }

    func togglePlayPause() { isPlaying ? pause() : resume() }

    func resume() {
        guard current != nil else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
    }

    func pause() {
        guard current != nil else { return }
        player.pause()
    }

    func next() {
        guard hasNext else { return }
        reportProgress()
        currentIndex += 1
        loadCurrent(autoplay: true)
    }

    func previous() {
        // Standard behaviour: restart the track if more than 3 s in, otherwise go back.
        if elapsed > 3 || !hasPrevious {
            seek(to: 0)
        } else {
            reportProgress()
            currentIndex -= 1
            loadCurrent(autoplay: true)
        }
    }

    func jump(to index: Int) {
        guard queue.indices.contains(index) else { return }
        reportProgress()
        currentIndex = index
        loadCurrent(autoplay: true)
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor [weak self] in self?.updateNowPlaying() }
        }
        elapsed = max(0, seconds)
    }

    func stop() {
        reportProgress()
        player.pause()
        player.replaceCurrentItem(with: nil)
        queue = []
        currentIndex = 0
        elapsed = 0
        duration = 0
        isPlaying = false
        artworkTask?.cancel()
        artwork = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Internals

    private func loadCurrent(autoplay: Bool) {
        guard let item = current, let api else { return }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        let source = api.urls.playback(for: item)
        let playerItem = AVPlayerItem(url: source.url)
        player.replaceCurrentItem(with: playerItem)
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: playerItem, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.trackEnded() }
        }
        elapsed = 0
        duration = item.durationSec ?? 0
        artwork = nil
        loadArtwork(for: item)
        updateNowPlaying()
        if autoplay { resume() }
    }

    private func trackEnded() {
        if let item = current {
            send(itemId: item.id, position: item.durationSec ?? elapsed, completed: true)
        }
        if hasNext {
            currentIndex += 1
            loadCurrent(autoplay: true)
        } else {
            player.pause()
            seek(to: 0)
        }
    }

    private func tick() {
        let t = player.currentTime().seconds
        if t.isFinite { elapsed = t }
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0, abs(d - duration) > 0.5 {
            duration = d
            updateNowPlaying()
        }
        if isPlaying, Date().timeIntervalSince(lastReportAt) >= 10 { reportProgress() }
    }

    private func reportProgress() {
        guard let item = current, elapsed > 0 else { return }
        send(itemId: item.id, position: elapsed, completed: nil)
    }

    private func send(itemId: String, position: Double, completed: Bool?) {
        guard let api else { return }
        lastReportAt = Date()
        let callback = onProgressReported
        Task {
            if (try? await api.reportProgress(itemId, positionSec: position, completed: completed)) != nil {
                callback?()
            }
        }
    }

    private func configureSessionAndRemote() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try? session.setActive(true)

        guard !remoteConfigured else { return }
        remoteConfigured = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.togglePlayPause() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.previous() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = e.positionTime
            Task { @MainActor [weak self] in self?.seek(to: position) }
            return .success
        }
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
    }

    private func updateNowPlaying() {
        guard let item = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.title,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyPlaybackQueueIndex: currentIndex,
            MPNowPlayingInfoPropertyPlaybackQueueCount: queue.count,
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artist = item.artist { info[MPMediaItemPropertyArtist] = artist }
        if let album = item.album { info[MPMediaItemPropertyAlbumTitle] = album }
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.isEnabled = hasNext
        center.previousTrackCommand.isEnabled = true
    }

    private func loadArtwork(for item: MediaItem) {
        artworkTask?.cancel()
        guard item.hasThumbnail, let url = api?.urls.thumbnailURL(item.id, width: 600) else { return }
        artworkTask = Task { [weak self] in
            guard let result = try? await URLSession.shared.data(from: url),
                  let image = UIImage(data: result.0),
                  !Task.isCancelled, let self, self.current?.id == item.id else { return }
            self.artwork = Self.makeArtwork(image)
            self.updateNowPlaying()
        }
    }

    /// Built outside the main actor: MediaPlayer calls the request handler on a background queue.
    private nonisolated static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
}
