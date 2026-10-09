import SwiftUI

@MainActor
final class BrowseModel: ObservableObject {
    let category: BrowseCategory
    @Published var items: [MediaItem] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var sort: MediaSort = .title
    @Published var order: MediaSortOrder = .asc

    private var nextOffset = 0
    private var total = Int.max
    private var generation = 0
    private let pageSize = 60

    init(category: BrowseCategory) {
        self.category = category
        if category == .photos { sort = .added; order = .desc }
    }

    var hasMore: Bool { nextOffset < total }

    func reset(api: APIClient, appState: AppState) async {
        generation += 1
        items = []
        nextOffset = 0
        total = .max
        error = nil
        await loadMore(api: api, appState: appState)
    }

    func loadMore(api: APIClient, appState: AppState) async {
        guard !isLoading, hasMore else { return }
        isLoading = true
        let gen = generation
        defer { isLoading = false }
        do {
            // Client-side filtering (Movies hides episodes) can yield empty pages; fetch on a few times.
            var attempts = 0
            repeat {
                let page = try await api.media(kind: category.kind, sort: sort, order: order,
                                               offset: nextOffset, limit: pageSize)
                guard gen == generation else { return }
                total = page.total
                nextOffset = page.offset + page.items.count
                if page.items.isEmpty { total = nextOffset }
                let visible = page.items.filter(category.includes)
                items += visible
                attempts += 1
                if !visible.isEmpty { break }
            } while hasMore && attempts < 5
        } catch {
            self.error = appState.handle(error)
        }
    }
}

struct BrowseView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var model: BrowseModel

    init(category: BrowseCategory) {
        _model = StateObject(wrappedValue: BrowseModel(category: category))
    }

    private var columns: [GridItem] {
        switch model.category.kind {
        case .video: return [GridItem(.adaptive(minimum: 160), spacing: 12)]
        case .audio: return [GridItem(.adaptive(minimum: 140), spacing: 12)]
        case .image: return [GridItem(.adaptive(minimum: 100), spacing: 4)]
        }
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: model.category.kind == .image ? 4 : 16) {
                ForEach(model.items) { item in
                    MediaItemLink(item: item, siblings: model.items) {
                        MediaCard(item: item)
                    }
                    .onAppear {
                        if item.id == model.items.last?.id { loadMore() }
                    }
                }
            }
            .padding(model.category.kind == .image ? 4 : 16)

            if model.isLoading {
                ProgressView().tint(Theme.accent).padding()
            } else if let error = model.error {
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load", message: error) {
                    loadMore()
                }
            } else if model.items.isEmpty && !model.hasMore {
                MessageView(systemImage: "tray", title: "No \(model.category.title.lowercased()) found")
            } else if model.hasMore && !model.items.isEmpty {
                // Client-side filtering (movies) can leave a page with nothing visible; keep a manual trigger.
                Color.clear.frame(height: 1).onAppear { loadMore() }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(model.category.title)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Picker("Sort by", selection: $model.sort) {
                        Text("Title").tag(MediaSort.title)
                        Text("Date added").tag(MediaSort.added)
                        Text("Date modified").tag(MediaSort.modified)
                        Text("Size").tag(MediaSort.size)
                        if model.category.kind != .image { Text("Duration").tag(MediaSort.duration) }
                    }
                    Picker("Order", selection: $model.order) {
                        Text("Ascending").tag(MediaSortOrder.asc)
                        Text("Descending").tag(MediaSortOrder.desc)
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down.circle")
                }
            }
        }
        .task {
            if model.items.isEmpty { await reset() }
        }
        .onChange(of: model.sort) { _ in Task { await reset() } }
        .onChange(of: model.order) { _ in Task { await reset() } }
        .refreshable { await reset() }
    }

    private func reset() async {
        guard let api = appState.api else { return }
        await model.reset(api: api, appState: appState)
    }

    private func loadMore() {
        guard let api = appState.api else { return }
        Task { await model.loadMore(api: api, appState: appState) }
    }
}

/// Library tab: categories, TV shows and folder browsing.
struct LibraryView: View {
    var body: some View {
        List {
            Section("Browse") {
                ForEach([BrowseCategory.movies, .allVideos, .music, .photos]) { category in
                    NavigationLink(value: AppRoute.browse(category)) {
                        Label(category.title, systemImage: category.systemImage)
                    }
                }
                NavigationLink(value: AppRoute.seriesList) {
                    Label("TV Shows", systemImage: "tv")
                }
            }
            Section("Files") {
                NavigationLink(value: AppRoute.libraries) {
                    Label("Folders", systemImage: "folder")
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenBackground()
        .navigationTitle("Library")
    }
}
