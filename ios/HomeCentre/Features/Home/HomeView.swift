import SwiftUI

@MainActor
final class HomeModel: ObservableObject {
    @Published var continueWatching: [MediaItem] = []
    @Published var recent: [MediaItem] = []
    @Published var movies: [MediaItem] = []
    @Published var series: [SeriesSummary] = []
    @Published var music: [MediaItem] = []
    @Published var photos: [MediaItem] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var loadedOnce = false

    func load(api: APIClient, appState: AppState) async {
        isLoading = true
        defer { isLoading = false; loadedOnce = true }
        do {
            async let cont = api.continueWatching()
            async let rec = api.recent(limit: 20)
            async let vids = api.media(kind: .video, sort: .added, order: .desc, limit: 60)
            async let ser = api.series()
            async let mus = api.media(kind: .audio, sort: .added, order: .desc, limit: 20)
            async let pho = api.media(kind: .image, sort: .added, order: .desc, limit: 20)

            let (c, r, v, s, m, p) = try await (cont, rec, vids, ser, mus, pho)
            continueWatching = c
            recent = r
            movies = Array(v.items.filter { $0.series == nil }.prefix(20))
            series = s
            music = m.items
            photos = p.items
            error = nil
        } catch {
            self.error = appState.handle(error)
        }
    }

    func refreshContinue(api: APIClient) async {
        if let c = try? await api.continueWatching() { continueWatching = c }
    }

    var isEmpty: Bool {
        continueWatching.isEmpty && recent.isEmpty && movies.isEmpty && series.isEmpty && music.isEmpty && photos.isEmpty
    }
}

struct HomeView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model = HomeModel()

    var body: some View {
        Group {
            if !model.loadedOnce && model.isLoading {
                LoadingView()
            } else if let error = model.error, model.isEmpty {
                MessageView(systemImage: "wifi.exclamationmark", title: "Couldn't load", message: error) {
                    Task { await reload() }
                }
            } else if model.loadedOnce && model.isEmpty {
                MessageView(systemImage: "tray", title: "Nothing here yet",
                            message: "Add media to your server's media folders and run a library scan.")
            } else {
                content
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(appState.serverName)
        .task { if !model.loadedOnce { await reload() } }
        .onChange(of: appState.progressRevision) { _ in
            guard let api = appState.api else { return }
            Task { await model.refreshContinue(api: api) }
        }
    }

    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if !model.continueWatching.isEmpty {
                    MediaRow(title: "Continue watching", items: model.continueWatching, cardWidth: 240)
                }
                if !model.recent.isEmpty {
                    MediaRow(title: "Recently added", items: model.recent, cardWidth: 200)
                }
                if !model.movies.isEmpty {
                    MediaRow(title: "Movies", items: model.movies, cardWidth: 200, seeAll: .browse(.movies))
                }
                if !model.series.isEmpty {
                    SeriesRow(series: model.series)
                }
                if !model.music.isEmpty {
                    MediaRow(title: "Music", items: model.music, cardWidth: 140, seeAll: .browse(.music))
                }
                if !model.photos.isEmpty {
                    MediaRow(title: "Photos", items: model.photos, cardWidth: 140, seeAll: .browse(.photos))
                }
            }
            .padding(.vertical, 16)
        }
        .refreshable { await reload() }
    }

    private func reload() async {
        guard let api = appState.api else { return }
        await model.load(api: api, appState: appState)
    }
}

struct SectionHeader: View {
    let title: String
    var seeAll: AppRoute? = nil

    var body: some View {
        HStack {
            Text(title).font(.title3.bold()).foregroundStyle(.white)
            Spacer()
            if let seeAll {
                NavigationLink("See all", value: seeAll)
                    .font(.subheadline)
            }
        }
        .padding(.horizontal, 16)
    }
}

struct MediaRow: View {
    let title: String
    let items: [MediaItem]
    var cardWidth: CGFloat = 200
    var seeAll: AppRoute? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title, seeAll: seeAll)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(items) { item in
                        MediaItemLink(item: item, siblings: items) {
                            MediaCard(item: item, width: cardWidth)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

struct SeriesRow: View {
    let series: [SeriesSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "TV Shows", seeAll: .seriesList)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(series) { show in
                        NavigationLink(value: AppRoute.episodes(seriesName: show.name)) {
                            SeriesCard(series: show, width: 200)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

struct SeriesCard: View {
    let series: SeriesSummary
    var width: CGFloat? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color.clear
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .overlay(ItemIdThumbnail(itemId: series.thumbnailItemId))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(series.name)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .lineLimit(1)
            Text("\(series.seasons.count) season\(series.seasons.count == 1 ? "" : "s") · \(series.episodeCount) episodes")
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        }
        .frame(width: width)
        .contentShape(Rectangle())
    }
}
