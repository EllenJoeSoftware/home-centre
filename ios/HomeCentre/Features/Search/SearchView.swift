import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var appState: AppState
    @State private var query = ""
    @State private var kind: MediaKind? = nil
    @State private var results: [MediaItem] = []
    @State private var isSearching = false
    @State private var error: String? = nil

    private struct SearchKey: Equatable {
        let query: String
        let kind: MediaKind?
    }

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                Text("Search titles, file names, artists and albums.")
                    .foregroundStyle(Theme.secondaryText)
                    .listRowBackground(Color.clear)
            } else if let error {
                Text(error).foregroundStyle(.orange).listRowBackground(Color.clear)
            } else if results.isEmpty && !isSearching {
                Text("No results for “\(query)”.")
                    .foregroundStyle(Theme.secondaryText)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(results) { item in
                    MediaItemLink(item: item, siblings: results) {
                        FileRow(item: item)
                    }
                    .listRowBackground(Theme.surface)
                }
            }
        }
        .listStyle(.plain)
        .screenBackground()
        .overlay(alignment: .top) {
            if isSearching { ProgressView().tint(Theme.accent).padding() }
        }
        .navigationTitle("Search")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Movies, music, photos…")
        .searchScopes($kind) {
            Text("All").tag(MediaKind?.none)
            Text("Video").tag(MediaKind?.some(.video))
            Text("Music").tag(MediaKind?.some(.audio))
            Text("Photos").tag(MediaKind?.some(.image))
        }
        .task(id: SearchKey(query: query, kind: kind)) {
            await search()
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, let api = appState.api else {
            results = []
            error = nil
            return
        }
        // Debounce: .task(id:) cancels this task when the query changes.
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            let page = try await api.media(kind: kind, query: q, sort: .title, limit: 100)
            guard !Task.isCancelled else { return }
            results = page.items
            error = nil
        } catch {
            if !Task.isCancelled { self.error = appState.handle(error) }
        }
    }
}
