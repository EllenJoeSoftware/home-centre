import SwiftUI

extension View {
    /// Pins the mini-player bar above the tab bar while audio is loaded.
    func withMiniPlayer() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) { MiniPlayerBar() }
    }
}

struct MiniPlayerBar: View {
    @EnvironmentObject private var player: AudioPlayer
    @EnvironmentObject private var presenter: Presenter

    var body: some View {
        if let item = player.current {
            VStack(spacing: 0) {
                ProgressBar(fraction: player.duration > 0 ? min(player.elapsed / player.duration, 1) : 0)
                    .frame(height: 2)
                HStack(spacing: 12) {
                    Color.clear
                        .frame(width: 44, height: 44)
                        .overlay(MediaThumbnail(item: item, width: 120))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(1)
                        if let artist = item.artist {
                            Text(artist).font(.caption).foregroundStyle(Theme.secondaryText).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    Button { player.togglePlayPause() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title3)
                            .frame(width: 40, height: 40)
                    }
                    .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    Button { player.next() } label: {
                        Image(systemName: "forward.fill").font(.title3).frame(width: 40, height: 40)
                    }
                    .disabled(!player.hasNext)
                    .accessibilityLabel("Next track")
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .background(Theme.surface)
            .contentShape(Rectangle())
            .onTapGesture { presenter.showAudioPlayer = true }
        }
    }
}

struct NowPlayingView: View {
    @EnvironmentObject private var player: AudioPlayer
    @Environment(\.dismiss) private var dismiss
    @State private var scrubbing: Double? = nil

    var body: some View {
        NavigationStack {
            Group {
                if let item = player.current {
                    ScrollView {
                        VStack(spacing: 20) {
                            Color.clear
                                .aspectRatio(1, contentMode: .fit)
                                .frame(maxWidth: 320)
                                .overlay(MediaThumbnail(item: item, width: 800))
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                                .shadow(radius: 20)
                                .padding(.top, 12)

                            VStack(spacing: 4) {
                                Text(item.title).font(.title3.bold()).foregroundStyle(.white).multilineTextAlignment(.center)
                                Text([item.artist, item.album].compactMap { $0 }.joined(separator: " · "))
                                    .font(.subheadline).foregroundStyle(Theme.secondaryText)
                            }

                            VStack(spacing: 4) {
                                Slider(
                                    value: Binding(
                                        get: { scrubbing ?? player.elapsed },
                                        set: { scrubbing = $0 }
                                    ),
                                    in: 0...max(player.duration, 1),
                                    onEditingChanged: { editing in
                                        if !editing, let value = scrubbing {
                                            player.seek(to: value)
                                            scrubbing = nil
                                        }
                                    }
                                )
                                HStack {
                                    Text(Format.duration(scrubbing ?? player.elapsed) ?? "0:00")
                                    Spacer()
                                    Text(Format.duration(player.duration) ?? "--:--")
                                }
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Theme.secondaryText)
                            }
                            .padding(.horizontal, 24)

                            HStack(spacing: 44) {
                                Button { player.previous() } label: { Image(systemName: "backward.fill").font(.title) }
                                    .accessibilityLabel("Previous")
                                Button { player.togglePlayPause() } label: {
                                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                        .font(.system(size: 64))
                                }
                                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                                Button { player.next() } label: { Image(systemName: "forward.fill").font(.title) }
                                    .disabled(!player.hasNext)
                                    .accessibilityLabel("Next")
                            }
                            .foregroundStyle(.white)

                            if player.queue.count > 1 {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text("Queue").font(.headline).foregroundStyle(.white).padding(.bottom, 8)
                                    ForEach(Array(player.queue.enumerated()), id: \.element.id) { index, track in
                                        Button { player.jump(to: index) } label: {
                                            HStack {
                                                Text("\(index + 1)").font(.caption.monospacedDigit())
                                                    .foregroundStyle(Theme.secondaryText).frame(width: 28, alignment: .leading)
                                                Text(track.title).lineLimit(1)
                                                    .foregroundStyle(index == player.currentIndex ? Theme.accent : .white)
                                                Spacer()
                                                Text(Format.duration(track.durationSec) ?? "")
                                                    .font(.caption).foregroundStyle(Theme.secondaryText)
                                            }
                                            .padding(.vertical, 8)
                                            .contentShape(Rectangle())
                                        }
                                        .buttonStyle(.plain)
                                        Divider().background(Color.white.opacity(0.1))
                                    }
                                }
                                .padding(16)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                                .padding(.horizontal, 16)
                            }
                        }
                        .padding(.bottom, 24)
                    }
                } else {
                    MessageView(systemImage: "music.note", title: "Nothing playing")
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Now Playing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "chevron.down") }
                        .accessibilityLabel("Close")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Stop") {
                        player.stop()
                        dismiss()
                    }
                }
            }
        }
        .presentationDragIndicator(.visible)
    }
}
