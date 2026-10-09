import SwiftUI

struct DetailView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var presenter: Presenter
    @EnvironmentObject private var audioPlayer: AudioPlayer

    @State private var item: MediaItem
    @State private var isStartingAudio = false
    @State private var error: String? = nil

    init(initialItem: MediaItem) {
        _item = State(initialValue: initialItem)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero

                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title)
                        .font(.title2.bold())
                        .foregroundStyle(.white)
                    if let line = item.subtitleLine {
                        Text(line).font(.subheadline).foregroundStyle(Theme.accent)
                    }
                    Text(metadataLine)
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryText)
                }
                .padding(.horizontal, 16)

                playButtons.padding(.horizontal, 16)

                if let error {
                    Text(error).font(.footnote).foregroundStyle(.orange).padding(.horizontal, 16)
                }

                infoSection.padding(.horizontal, 16)
            }
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await refresh() }
        .onChange(of: appState.progressRevision) { _ in Task { await refresh() } }
    }

    // MARK: - Sections

    private var hero: some View {
        Color.clear
            .aspectRatio(item.kind == .video ? 16.0 / 9.0 : 1, contentMode: .fit)
            .frame(maxWidth: item.kind == .video ? CGFloat.infinity : 320)
            .overlay(MediaThumbnail(item: item, width: 1000))
            .overlay(alignment: .bottom) {
                if let f = item.progressFraction, f > 0 { ProgressBar(fraction: f) }
            }
            .clipShape(RoundedRectangle(cornerRadius: item.kind == .video ? 0 : 12))
            .frame(maxWidth: .infinity)
            .padding(.top, item.kind == .video ? 0 : 16)
    }

    @ViewBuilder
    private var playButtons: some View {
        switch item.kind {
        case .video:
            HStack(spacing: 12) {
                Button {
                    presenter.play(video: item)
                } label: {
                    Label(item.resumePosition != nil ? "Resume" : "Play", systemImage: "play.fill")
                        .bold()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)

                if item.progress?.completed == true || item.resumePosition != nil {
                    Button {
                        markWatched(!(item.progress?.completed ?? false))
                    } label: {
                        Image(systemName: item.progress?.completed == true ? "checkmark.circle.fill" : "checkmark.circle")
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel(item.progress?.completed == true ? "Mark unwatched" : "Mark watched")
                }
            }
            if !item.directPlayable {
                Label("Will be transcoded for playback", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
            }
        case .audio:
            HStack(spacing: 12) {
                Button {
                    playAudio(albumMode: false)
                } label: {
                    Label("Play", systemImage: "play.fill").bold()
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    playAudio(albumMode: true)
                } label: {
                    Label("Play folder", systemImage: "music.note.list")
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.bordered)
                .disabled(isStartingAudio)
            }
        case .image:
            Button {
                presenter.show(photo: item, in: [item])
            } label: {
                Label("View", systemImage: "photo").bold()
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Details").font(.headline).foregroundStyle(.white)
            infoRow("File", item.fileName)
            infoRow("Folder", item.folder.isEmpty ? "/" : item.folder)
            infoRow("Size", Format.bytes(item.size))
            if let w = item.width, let h = item.height { infoRow("Resolution", "\(w)×\(h)") }
            if let c = item.container { infoRow("Container", c) }
            if let v = item.videoCodec { infoRow("Video", v) }
            if let a = item.audioCodec { infoRow("Audio", a) }
            if !item.subtitles.isEmpty {
                infoRow("Subtitles", item.subtitles.map(\.label).joined(separator: ", "))
            }
            infoRow("Added", Format.date(item.addedAt))
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).foregroundStyle(Theme.secondaryText).frame(width: 90, alignment: .leading)
            Text(value).foregroundStyle(.white).textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .font(.footnote)
    }

    private var metadataLine: String {
        var parts: [String] = []
        if let y = item.year { parts.append(String(y)) }
        if let d = Format.duration(item.durationSec) { parts.append(d) }
        if let h = item.height { parts.append(h >= 2000 ? "4K" : h >= 1000 ? "HD" : "\(h)p") }
        if let p = item.resumePosition, let s = Format.duration(p) { parts.append("Resume at \(s)") }
        if item.progress?.completed == true { parts.append("Watched") }
        return parts.joined(separator: " · ")
    }

    // MARK: - Actions

    private func refresh() async {
        guard let api = appState.api else { return }
        if let fresh = try? await api.item(item.id) { item = fresh }
    }

    private func markWatched(_ watched: Bool) {
        guard let api = appState.api else { return }
        Task {
            do {
                let pos = watched ? (item.durationSec ?? 0) : 0
                _ = try await api.reportProgress(item.id, positionSec: pos, completed: watched)
                appState.progressRevision += 1
            } catch {
                self.error = appState.handle(error)
            }
        }
    }

    private func playAudio(albumMode: Bool) {
        guard albumMode, let api = appState.api else {
            audioPlayer.play(queue: [item], startIndex: 0)
            return
        }
        isStartingAudio = true
        Task {
            defer { isStartingAudio = false }
            do {
                let page = try await api.media(kind: .audio, libraryId: item.libraryId, folder: item.folder,
                                               sort: .title, limit: 500)
                let queue = page.items.isEmpty ? [item] : page.items
                let start = queue.firstIndex(where: { $0.id == item.id }) ?? 0
                audioPlayer.play(queue: queue, startIndex: start)
            } catch {
                self.error = appState.handle(error)
            }
        }
    }
}
