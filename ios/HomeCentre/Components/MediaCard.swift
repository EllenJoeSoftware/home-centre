import SwiftUI

/// Thumbnail with token-authenticated AsyncImage and a kind-appropriate placeholder.
struct MediaThumbnail: View {
    @EnvironmentObject private var appState: AppState
    let item: MediaItem
    var width: Int = 400

    var body: some View {
        ZStack {
            Theme.surface
            if let url = appState.urls?.artworkURL(for: item, width: width) {
                AsyncImage(url: url, transaction: Transaction(animation: .easeIn(duration: 0.15))) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    case .failure:
                        placeholder
                    default:
                        ProgressView().tint(Theme.secondaryText)
                    }
                }
            } else {
                placeholder
            }
        }
        .clipped()
    }

    private var placeholder: some View {
        Image(systemName: Self.symbol(for: item.kind))
            .font(.system(size: 28, weight: .regular))
            .foregroundStyle(Theme.secondaryText)
    }

    static func symbol(for kind: MediaKind) -> String {
        switch kind {
        case .video: return "film"
        case .audio: return "music.note"
        case .image: return "photo"
        }
    }
}

/// Thumbnail for an arbitrary item id (used by series posters).
struct ItemIdThumbnail: View {
    @EnvironmentObject private var appState: AppState
    let itemId: String?
    var symbol: String = "tv"

    var body: some View {
        ZStack {
            Theme.surface
            if let itemId, let url = appState.urls?.thumbnailURL(itemId, width: 400) {
                AsyncImage(url: url) { phase in
                    if case let .success(image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        Image(systemName: symbol).font(.title).foregroundStyle(Theme.secondaryText)
                    }
                }
            } else {
                Image(systemName: symbol).font(.title).foregroundStyle(Theme.secondaryText)
            }
        }
        .clipped()
    }
}

struct ProgressBar: View {
    let fraction: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.white.opacity(0.25))
                Rectangle().fill(Theme.accent).frame(width: geo.size.width * fraction)
            }
        }
        .frame(height: 4)
    }
}

/// Card used in rows and grids.
struct MediaCard: View {
    let item: MediaItem
    var width: CGFloat? = nil
    var showProgress: Bool = true

    private var aspect: CGFloat {
        switch item.kind {
        case .video: return 16.0 / 9.0
        case .audio, .image: return 1
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color.clear
                .aspectRatio(aspect, contentMode: .fit)
                .overlay(MediaThumbnail(item: item))
                .overlay(alignment: .bottom) {
                    if showProgress, let f = item.progressFraction, f > 0 {
                        ProgressBar(fraction: f)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            if item.kind != .image {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                if let line = item.subtitleLine ?? Format.duration(item.durationSec) {
                    Text(line)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
            }
        }
        .frame(width: width)
        .contentShape(Rectangle())
    }
}

struct LoadingView: View {
    var body: some View {
        ProgressView()
            .tint(Theme.accent)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct MessageView: View {
    let systemImage: String
    let title: String
    var message: String? = nil
    var retry: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundStyle(Theme.secondaryText)
            Text(title).font(.headline).foregroundStyle(.white)
            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
            if let retry {
                Button("Retry", action: retry).buttonStyle(.borderedProminent)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
