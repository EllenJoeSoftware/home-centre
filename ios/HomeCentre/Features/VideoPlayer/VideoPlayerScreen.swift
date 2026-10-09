import AVKit
import SwiftUI
import UIKit

/// Full-screen video playback: resume prompt → AVPlayerViewController + subtitle overlay.
struct VideoPlayerScreen: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var audioPlayer: AudioPlayer
    @Environment(\.dismiss) private var dismiss

    let item: MediaItem

    private enum Phase {
        case loading
        case prompt(resumeAt: Double)
        case playing
    }

    @State private var phase: Phase = .loading
    @State private var controller: VideoPlayerController? = nil

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch phase {
            case .loading:
                ProgressView().tint(.white)
            case let .prompt(resumeAt):
                resumePrompt(resumeAt)
            case .playing:
                if let controller {
                    VStack(spacing: 0) {
                        PlayerTopBar(item: item, controller: controller, onClose: close)
                        PlayerContainer(controller: controller)
                            .ignoresSafeArea(edges: .bottom)
                    }
                }
            }
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .task { await prepare() }
        .onDisappear { controller?.stop() }
    }

    // MARK: - Pieces

    private func resumePrompt(_ position: Double) -> some View {
        VStack(spacing: 16) {
            Text(item.title).font(.title3.bold()).foregroundStyle(.white).multilineTextAlignment(.center)
            Text("You stopped at \(Format.duration(position) ?? "0:00").")
                .foregroundStyle(Theme.secondaryText)
            Button {
                begin(at: position)
            } label: {
                Label("Resume from \(Format.duration(position) ?? "")", systemImage: "play.fill")
                    .bold().frame(maxWidth: 280).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            Button {
                begin(at: nil)
            } label: {
                Label("Start over", systemImage: "backward.end.fill")
                    .frame(maxWidth: 280).padding(.vertical, 6)
            }
            .buttonStyle(.bordered)
            .tint(.white)
            Button("Cancel", action: close)
                .foregroundStyle(Theme.secondaryText)
                .padding(.top, 8)
        }
        .padding(32)
    }

    // MARK: - Flow

    private func prepare() async {
        guard case .loading = phase else { return }
        audioPlayer.pause()
        var current = item
        if let api = appState.api, let fresh = try? await api.item(item.id) {
            current = fresh
        }
        if let resume = current.resumePosition {
            phase = .prompt(resumeAt: resume)
        } else {
            begin(at: nil)
        }
    }

    private func begin(at position: Double?) {
        guard let api = appState.api else { close(); return }
        let c = VideoPlayerController(item: item, api: api)
        c.onProgressReported = { [weak appState] in appState?.progressRevision += 1 }
        controller = c
        phase = .playing
        c.start(at: position)
    }

    private func close() {
        controller?.stop()
        dismiss()
    }
}

private struct PlayerTopBar: View {
    let item: MediaItem
    @ObservedObject var controller: VideoPlayerController
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.headline)
                    .frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.12), in: Circle())
            }
            .accessibilityLabel("Close")

            Text(item.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            if !item.subtitles.isEmpty {
                SubtitleMenu(item: item, controller: controller)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            if let message = controller.errorMessage {
                Text(message)
                    .font(.caption)
                    .padding(8)
                    .background(Color.orange.opacity(0.9), in: Capsule())
                    .offset(y: 36)
                    .onTapGesture { controller.errorMessage = nil }
            }
        }
        .zIndex(1)
    }
}

private struct SubtitleMenu: View {
    let item: MediaItem
    @ObservedObject var controller: VideoPlayerController

    var body: some View {
        Menu {
            Button {
                controller.selectSubtitle(nil)
            } label: {
                if controller.selectedSubtitleId == nil { Label("Off", systemImage: "checkmark") } else { Text("Off") }
            }
            ForEach(item.subtitles) { track in
                Button {
                    controller.selectSubtitle(track.id)
                } label: {
                    if controller.selectedSubtitleId == track.id {
                        Label(track.label, systemImage: "checkmark")
                    } else {
                        Text(track.label)
                    }
                }
            }
        } label: {
            Group {
                if controller.isLoadingSubtitles {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: controller.selectedSubtitleId == nil ? "captions.bubble" : "captions.bubble.fill")
                        .font(.headline)
                }
            }
            .frame(width: 36, height: 36)
            .background(Color.white.opacity(0.12), in: Circle())
        }
        .accessibilityLabel("Subtitles")
    }
}

/// AVPlayerViewController with our subtitle overlay installed in its `contentOverlayView`
/// (which sits above the video but below the system controls, and follows it into full screen).
struct PlayerContainer: UIViewControllerRepresentable {
    let controller: VideoPlayerController

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = controller.player
        vc.showsPlaybackControls = true
        vc.allowsPictureInPicturePlayback = true
        vc.canStartPictureInPictureAutomaticallyFromInline = true
        vc.entersFullScreenWhenPlaybackBegins = false
        vc.exitsFullScreenWhenPlaybackEnds = false
        vc.videoGravity = .resizeAspect
        vc.view.backgroundColor = .black

        let host = UIHostingController(rootView: SubtitleOverlay(controller: controller))
        host.view.backgroundColor = .clear
        host.view.isUserInteractionEnabled = false
        host.view.translatesAutoresizingMaskIntoConstraints = false
        if let overlay = vc.contentOverlayView {
            overlay.addSubview(host.view)
            NSLayoutConstraint.activate([
                host.view.leadingAnchor.constraint(equalTo: overlay.leadingAnchor),
                host.view.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
                host.view.topAnchor.constraint(equalTo: overlay.topAnchor),
                host.view.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),
            ])
        }
        context.coordinator.host = host
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== controller.player { vc.player = controller.player }
    }

    static func dismantleUIViewController(_ vc: AVPlayerViewController, coordinator: Coordinator) {
        vc.player = nil
        coordinator.host?.view.removeFromSuperview()
        coordinator.host = nil
    }

    final class Coordinator {
        var host: UIHostingController<SubtitleOverlay>?
    }
}

struct SubtitleOverlay: View {
    @ObservedObject var controller: VideoPlayerController

    var body: some View {
        VStack {
            Spacer()
            if let text = controller.subtitleText {
                Text(text)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .shadow(color: .black, radius: 1, x: 1, y: 1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 6))
                    .padding(.horizontal, 24)
                    .padding(.bottom, 56)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }
}
