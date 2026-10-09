import SwiftUI

struct SeriesListView: View {
    @EnvironmentObject private var appState: AppState
    @State private var series: [SeriesSummary] = []
    @State private var isLoading = true
    @State private var error: String? = nil

    var body: some View {
        Group {
            if isLoading && series.isEmpty {
                LoadingView()
            } else if let error, series.isEmpty {
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load", message: error) {
                    Task { await load() }
                }
            } else if series.isEmpty {
                MessageView(systemImage: "tv", title: "No TV shows",
                            message: "Episodes are detected from names like S01E02 or 1x02.")
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 16) {
                        ForEach(series) { show in
                            NavigationLink(value: AppRoute.episodes(seriesName: show.name)) {
                                SeriesCard(series: show)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
                .refreshable { await load() }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("TV Shows")
        .task { if series.isEmpty { await load() } }
    }

    private func load() async {
        guard let api = appState.api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            series = try await api.series().sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            error = nil
        } catch {
            self.error = appState.handle(error)
        }
    }
}

struct EpisodesView: View {
    @EnvironmentObject private var appState: AppState
    let seriesName: String
    @State private var episodes: [MediaItem] = []
    @State private var isLoading = true
    @State private var error: String? = nil

    private struct SeasonGroup: Identifiable {
        let season: Int
        let items: [MediaItem]
        var id: Int { season }
    }

    private var seasons: [SeasonGroup] {
        let grouped = Dictionary(grouping: episodes) { $0.series?.season ?? 0 }
        return grouped.keys.sorted().map { SeasonGroup(season: $0, items: grouped[$0] ?? []) }
    }

    var body: some View {
        Group {
            if isLoading && episodes.isEmpty {
                LoadingView()
            } else if let error, episodes.isEmpty {
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load", message: error) {
                    Task { await load() }
                }
            } else {
                List {
                    ForEach(seasons) { group in
                        Section(group.season == 0 ? "Specials" : "Season \(group.season)") {
                            ForEach(group.items) { ep in
                                NavigationLink(value: AppRoute.item(ep)) {
                                    EpisodeRow(item: ep)
                                }
                                .listRowBackground(Theme.surface)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .screenBackground()
                .refreshable { await load() }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(seriesName)
        .task { await load() }
        .onChange(of: appState.progressRevision) { _ in Task { await load() } }
    }

    private func load() async {
        guard let api = appState.api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            episodes = try await api.episodes(seriesName: seriesName)
            error = nil
        } catch {
            self.error = appState.handle(error)
        }
    }
}

struct EpisodeRow: View {
    let item: MediaItem

    var body: some View {
        HStack(spacing: 12) {
            Color.clear
                .frame(width: 120, height: 68)
                .overlay(MediaThumbnail(item: item, width: 240))
                .overlay(alignment: .bottom) {
                    if let f = item.progressFraction, f > 0 { ProgressBar(fraction: f) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 4) {
                if let s = item.series {
                    Text("Episode \(s.episode)").font(.caption).foregroundStyle(Theme.accent)
                }
                Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(.white).lineLimit(2)
                if let d = Format.duration(item.durationSec) {
                    Text(d).font(.caption).foregroundStyle(Theme.secondaryText)
                }
            }
            Spacer(minLength: 0)
            if item.progress?.completed == true {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
            }
        }
        .padding(.vertical, 4)
    }
}
