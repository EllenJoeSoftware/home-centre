import SwiftUI
import UIKit

@main
struct HomeCentreApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var audioPlayer = AudioPlayer()

    init() {
        // Generous HTTP cache so AsyncImage thumbnails aren't refetched constantly.
        URLCache.shared = URLCache(memoryCapacity: 64 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024)
        Theme.configureUIKitAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(audioPlayer)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var audioPlayer: AudioPlayer

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch appState.phase {
            case .needsServer:
                ServerSetupView()
            case .needsLogin:
                LoginView()
            case .ready:
                MainTabView()
                    .task { await appState.refreshSession() }
            }
        }
        .onChange(of: appState.phase) { phase in
            if phase != .ready { audioPlayer.stop() }
        }
        .onReceive(appState.$api) { api in
            audioPlayer.api = api
            audioPlayer.onProgressReported = { [weak appState] in appState?.progressRevision += 1 }
        }
    }
}

struct MainTabView: View {
    @StateObject private var presenter = Presenter()

    var body: some View {
        TabView {
            NavigationStack { HomeView().withAppDestinations() }
                .withMiniPlayer()
                .tabItem { Label("Home", systemImage: "house.fill") }

            NavigationStack { LibraryView().withAppDestinations() }
                .withMiniPlayer()
                .tabItem { Label("Library", systemImage: "square.grid.2x2.fill") }

            NavigationStack { SearchView().withAppDestinations() }
                .withMiniPlayer()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }

            NavigationStack { SettingsView() }
                .withMiniPlayer()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .environmentObject(presenter)
        // Presentation content does not inherit objects injected *below* the modifier, so re-inject.
        .fullScreenCover(item: $presenter.video) { session in
            VideoPlayerScreen(item: session.item)
                .environmentObject(presenter)
        }
        .background(
            Color.clear.fullScreenCover(item: $presenter.photos) { session in
                PhotoViewer(items: session.items, startId: session.startId)
                    .environmentObject(presenter)
            }
        )
        .sheet(isPresented: $presenter.showAudioPlayer) {
            NowPlayingView()
                .environmentObject(presenter)
        }
    }
}
