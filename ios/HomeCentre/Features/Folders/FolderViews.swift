import SwiftUI

struct LibrariesView: View {
    @EnvironmentObject private var appState: AppState
    @State private var libraries: [Library] = []
    @State private var isLoading = true
    @State private var error: String? = nil

    var body: some View {
        Group {
            if isLoading && libraries.isEmpty {
                LoadingView()
            } else if let error, libraries.isEmpty {
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load", message: error) {
                    Task { await load() }
                }
            } else {
                List(libraries) { lib in
                    NavigationLink(value: AppRoute.folder(libraryId: lib.id, path: "", title: lib.name)) {
                        HStack {
                            Label(lib.name, systemImage: "externaldrive")
                            Spacer()
                            Text("\(lib.itemCount)").foregroundStyle(Theme.secondaryText)
                        }
                    }
                    .listRowBackground(Theme.surface)
                }
                .screenBackground()
                .refreshable { await load() }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Folders")
        .task { if libraries.isEmpty { await load() } }
    }

    private func load() async {
        guard let api = appState.api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            libraries = try await api.libraries()
            error = nil
        } catch {
            self.error = appState.handle(error)
        }
    }
}

struct FolderView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var audioPlayer: AudioPlayer
    let libraryId: String
    let path: String
    let title: String

    @State private var listing: FolderListing? = nil
    @State private var isLoading = true
    @State private var error: String? = nil

    private var audioItems: [MediaItem] { listing?.items.filter { $0.kind == .audio } ?? [] }

    var body: some View {
        Group {
            if isLoading && listing == nil {
                LoadingView()
            } else if let error, listing == nil {
                MessageView(systemImage: "exclamationmark.triangle", title: "Couldn't load", message: error) {
                    Task { await load() }
                }
            } else if let listing {
                List {
                    if !audioItems.isEmpty {
                        Section {
                            Button {
                                audioPlayer.play(queue: audioItems, startIndex: 0)
                            } label: {
                                Label("Play all (\(audioItems.count))", systemImage: "play.fill")
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                    if !listing.folders.isEmpty {
                        Section("Folders") {
                            ForEach(listing.folders) { folder in
                                NavigationLink(value: AppRoute.folder(libraryId: libraryId, path: folder.path, title: folder.name)) {
                                    Label(folder.name, systemImage: "folder.fill")
                                }
                                .listRowBackground(Theme.surface)
                            }
                        }
                    }
                    if !listing.items.isEmpty {
                        Section("Files") {
                            ForEach(listing.items) { item in
                                MediaItemLink(item: item, siblings: listing.items) {
                                    FileRow(item: item)
                                }
                                .listRowBackground(Theme.surface)
                            }
                        }
                    }
                    if listing.folders.isEmpty && listing.items.isEmpty {
                        Text("This folder is empty.").foregroundStyle(Theme.secondaryText)
                            .listRowBackground(Theme.surface)
                    }
                }
                .listStyle(.insetGrouped)
                .screenBackground()
                .refreshable { await load() }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { if listing == nil { await load() } }
    }

    private func load() async {
        guard let api = appState.api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            listing = try await api.folders(libraryId: libraryId, path: path)
            error = nil
        } catch {
            self.error = appState.handle(error)
        }
    }
}

struct FileRow: View {
    let item: MediaItem

    var body: some View {
        HStack(spacing: 12) {
            Color.clear
                .frame(width: 56, height: 56)
                .overlay(MediaThumbnail(item: item, width: 120))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(.white).lineLimit(2)
                Text([item.subtitleLine, Format.duration(item.durationSec), Format.bytes(item.size)]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
