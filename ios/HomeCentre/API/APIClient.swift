import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking // Linux typecheck harness only
#endif

enum APIError: LocalizedError, Equatable {
    case unauthorized
    case http(status: Int, message: String?)
    case decoding(String)
    case transport(String)
    case invalidServer

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Your session has expired. Please sign in again."
        case let .http(status, message): return message ?? "Server returned HTTP \(status)."
        case let .decoding(detail): return "Unexpected response from server (\(detail))."
        case let .transport(detail): return detail
        case .invalidServer: return "That doesn't look like a Home Centre server."
        }
    }
}

/// Thin async/await client for docs/API.md. Immutable configuration: create a new instance
/// when the server URL or token changes (AppState does this).
actor APIClient {
    nonisolated let urls: MediaURLBuilder
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(baseURL: URL, token: String?, session: URLSession = .shared) {
        self.urls = MediaURLBuilder(baseURL: baseURL, token: token)
        self.session = session
    }

    // MARK: - Core

    private func request<T: Decodable, B: Encodable>(
        _ method: String,
        _ segments: [String],
        query: [URLQueryItem] = [],
        body: B? = Optional<Empty>.none,
        as type: T.Type
    ) async throws -> T {
        let data = try await raw(method, segments, query: query, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    @discardableResult
    private func raw<B: Encodable>(
        _ method: String,
        _ segments: [String],
        query: [URLQueryItem] = [],
        body: B? = Optional<Empty>.none
    ) async throws -> Data {
        var req = URLRequest(url: urls.url(segments, query: query))
        req.httpMethod = method
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = urls.token, !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { throw CancellationError() }
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No HTTP response") }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            throw APIError.unauthorized
        default:
            let message = (try? decoder.decode(ErrorResponse.self, from: data))?.error
            throw APIError.http(status: http.statusCode, message: message)
        }
    }

    private struct Empty: Encodable {}

    // MARK: - Server / auth

    func health() async throws -> HealthResponse {
        try await request("GET", ["api", "health"], as: HealthResponse.self)
    }

    func serverInfo() async throws -> ServerInfo {
        try await request("GET", ["api", "server", "info"], as: ServerInfo.self)
    }

    func login(username: String, password: String) async throws -> LoginResponse {
        try await request("POST", ["api", "auth", "login"],
                          body: LoginRequest(username: username, password: password),
                          as: LoginResponse.self)
    }

    func me() async throws -> User {
        try await request("GET", ["api", "me"], as: User.self)
    }

    // MARK: - Libraries / scan

    func libraries() async throws -> [Library] {
        try await request("GET", ["api", "libraries"], as: [Library].self)
    }

    func startScan() async throws -> ScanStarted {
        try await request("POST", ["api", "libraries", "scan"], as: ScanStarted.self)
    }

    func scanStatus() async throws -> ScanStatus {
        try await request("GET", ["api", "scan", "status"], as: ScanStatus.self)
    }

    // MARK: - Media

    func media(
        kind: MediaKind? = nil,
        libraryId: String? = nil,
        folder: String? = nil,
        query q: String? = nil,
        sort: MediaSort = .title,
        order: MediaSortOrder = .asc,
        offset: Int = 0,
        limit: Int = 50
    ) async throws -> Page<MediaItem> {
        var items: [URLQueryItem] = []
        if let kind { items.append(.init(name: "kind", value: kind.rawValue)) }
        if let libraryId { items.append(.init(name: "libraryId", value: libraryId)) }
        if let folder { items.append(.init(name: "folder", value: folder)) }
        if let q, !q.isEmpty { items.append(.init(name: "q", value: q)) }
        items.append(.init(name: "sort", value: sort.rawValue))
        items.append(.init(name: "order", value: order.rawValue))
        items.append(.init(name: "offset", value: String(offset)))
        items.append(.init(name: "limit", value: String(min(max(limit, 1), 500))))
        return try await request("GET", ["api", "media"], query: items, as: Page<MediaItem>.self)
    }

    func recent(limit: Int = 20) async throws -> [MediaItem] {
        try await request("GET", ["api", "media", "recent"],
                          query: [.init(name: "limit", value: String(limit))], as: [MediaItem].self)
    }

    func continueWatching() async throws -> [MediaItem] {
        try await request("GET", ["api", "media", "continue"], as: [MediaItem].self)
    }

    func item(_ id: String) async throws -> MediaItem {
        try await request("GET", ["api", "media", id], as: MediaItem.self)
    }

    func folders(libraryId: String, path: String = "") async throws -> FolderListing {
        try await request("GET", ["api", "folders"],
                          query: [.init(name: "libraryId", value: libraryId), .init(name: "path", value: path)],
                          as: FolderListing.self)
    }

    func series() async throws -> [SeriesSummary] {
        try await request("GET", ["api", "series"], as: [SeriesSummary].self)
    }

    func episodes(seriesName: String) async throws -> [MediaItem] {
        try await request("GET", ["api", "series", seriesName, "episodes"], as: [MediaItem].self)
    }

    func progress(_ id: String) async throws -> MediaProgress? {
        try await request("GET", ["api", "media", id, "progress"], as: MediaProgress?.self)
    }

    @discardableResult
    func reportProgress(_ id: String, positionSec: Double, completed: Bool? = nil) async throws -> MediaProgress {
        try await request("PUT", ["api", "media", id, "progress"],
                          body: ProgressUpdate(positionSec: max(0, positionSec), completed: completed),
                          as: MediaProgress.self)
    }

    /// Fetches a WebVTT document as text.
    func subtitleText(itemId: String, subId: String) async throws -> String {
        let data = try await raw("GET", ["api", "media", itemId, "subtitles", subId])
        return String(decoding: data, as: UTF8.self)
    }
}
