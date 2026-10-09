import SwiftUI

/// Browse categories reachable from Home "See all" and the Library tab.
enum BrowseCategory: String, Hashable, CaseIterable, Identifiable {
    case movies, music, photos, allVideos

    var id: String { rawValue }

    var title: String {
        switch self {
        case .movies: return "Movies"
        case .music: return "Music"
        case .photos: return "Photos"
        case .allVideos: return "All Videos"
        }
    }

    var kind: MediaKind {
        switch self {
        case .movies, .allVideos: return .video
        case .music: return .audio
        case .photos: return .image
        }
    }

    var systemImage: String {
        switch self {
        case .movies: return "film"
        case .music: return "music.note"
        case .photos: return "photo.on.rectangle"
        case .allVideos: return "play.rectangle"
        }
    }

    /// Client-side filter (the API has no movie/episode distinction other than `series`).
    func includes(_ item: MediaItem) -> Bool {
        self == .movies ? item.series == nil : true
    }
}

enum AppRoute: Hashable {
    case item(MediaItem)
    case browse(BrowseCategory)
    case seriesList
    case episodes(seriesName: String)
    case libraries
    case folder(libraryId: String, path: String, title: String)
}

extension View {
    /// Register all app routes. Apply once at the root of each NavigationStack.
    func withAppDestinations() -> some View {
        navigationDestination(for: AppRoute.self) { route in
            switch route {
            case let .item(item):
                DetailView(initialItem: item)
            case let .browse(category):
                BrowseView(category: category)
            case .seriesList:
                SeriesListView()
            case let .episodes(name):
                EpisodesView(seriesName: name)
            case .libraries:
                LibrariesView()
            case let .folder(libraryId, path, title):
                FolderView(libraryId: libraryId, path: path, title: title)
            }
        }
    }
}

/// App-wide presenter for full-screen players, so any screen can start playback.
@MainActor
final class Presenter: ObservableObject {
    struct VideoSession: Identifiable {
        let id = UUID()
        let item: MediaItem
    }

    struct PhotoSession: Identifiable {
        let id = UUID()
        let items: [MediaItem]
        let startId: String
    }

    @Published var video: VideoSession?
    @Published var photos: PhotoSession?
    @Published var showAudioPlayer = false

    func play(video item: MediaItem) {
        video = VideoSession(item: item)
    }

    func show(photo item: MediaItem, in list: [MediaItem]) {
        let images = list.filter { $0.kind == .image }
        photos = PhotoSession(items: images.isEmpty ? [item] : images, startId: item.id)
    }
}

/// Tapping a media item: photos open the viewer directly (with their siblings for swiping),
/// everything else navigates to the detail screen.
struct MediaItemLink<Label: View>: View {
    @EnvironmentObject private var presenter: Presenter
    let item: MediaItem
    var siblings: [MediaItem] = []
    @ViewBuilder let label: () -> Label

    var body: some View {
        if item.kind == .image {
            Button {
                presenter.show(photo: item, in: siblings.isEmpty ? [item] : siblings)
            } label: { label() }
            .buttonStyle(.plain)
        } else {
            NavigationLink(value: AppRoute.item(item)) { label() }
                .buttonStyle(.plain)
        }
    }
}
