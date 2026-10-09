import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    enum Phase: Equatable {
        case needsServer
        case needsLogin
        case ready
    }

    @Published private(set) var phase: Phase
    @Published private(set) var serverURL: URL?
    @Published private(set) var user: User?
    @Published private(set) var serverName: String = "Home Centre"
    @Published var api: APIClient?
    /// Bumped whenever playback progress was reported, so Home can refresh "Continue watching".
    @Published var progressRevision: Int = 0

    private var token: String?

    init() {
        let url = ServerSettings.serverURL
        let token = KeychainTokenStore.load()
        self.serverURL = url
        self.token = token
        self.user = ServerSettings.user
        if let url {
            self.api = APIClient(baseURL: url, token: token)
            self.phase = (token == nil) ? .needsLogin : .ready
        } else {
            self.api = nil
            self.phase = .needsServer
        }
    }

    var urls: MediaURLBuilder? { api?.urls }

    // MARK: - Server

    /// Validates the URL against /api/server/info and stores it.
    func connect(to rawURL: String) async throws {
        guard let url = MediaURLBuilder.normalizeServerURL(rawURL) else {
            throw APIError.transport("Please enter a valid server address, e.g. http://192.168.1.10:8096")
        }
        let probe = APIClient(baseURL: url, token: nil)
        let info: ServerInfo
        do {
            info = try await probe.serverInfo()
        } catch APIError.decoding {
            throw APIError.invalidServer
        } catch let APIError.http(status, _) where status == 404 {
            throw APIError.invalidServer
        }
        serverName = info.name
        ServerSettings.serverURL = url
        serverURL = url
        token = nil
        KeychainTokenStore.delete()
        api = APIClient(baseURL: url, token: nil)
        phase = .needsLogin
    }

    func changeServer() {
        logout()
        ServerSettings.serverURL = nil
        serverURL = nil
        api = nil
        phase = .needsServer
    }

    // MARK: - Auth

    func login(username: String, password: String) async throws {
        guard let serverURL else { phase = .needsServer; return }
        let client = APIClient(baseURL: serverURL, token: nil)
        let response = try await client.login(username: username, password: password)
        KeychainTokenStore.save(response.token)
        ServerSettings.user = response.user
        token = response.token
        user = response.user
        api = APIClient(baseURL: serverURL, token: response.token)
        phase = .ready
    }

    func logout() {
        KeychainTokenStore.delete()
        ServerSettings.user = nil
        token = nil
        user = nil
        if let serverURL { api = APIClient(baseURL: serverURL, token: nil) }
        phase = serverURL == nil ? .needsServer : .needsLogin
    }

    /// Re-validates a stored token at launch; a 401 sends the user back to login.
    func refreshSession() async {
        guard phase == .ready, let api else { return }
        if let info = try? await api.serverInfo() { serverName = info.name }
        do {
            let me = try await api.me()
            user = me
            ServerSettings.user = me
        } catch {
            handle(error)
        }
    }

    /// Call from views on any API error. Returns a user-facing message (nil for cancellations).
    @discardableResult
    func handle(_ error: Error) -> String? {
        if error is CancellationError { return nil }
        if let apiError = error as? APIError, apiError == .unauthorized {
            logout()
            return apiError.errorDescription
        }
        return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
