import Foundation

/// Pure, synchronous URL construction for the Home Centre API.
/// Value type so it can be used from views (AsyncImage, AVPlayer) without awaiting the APIClient actor.
struct MediaURLBuilder: Hashable, Sendable {
    let baseURL: URL
    let token: String?

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.token = token
    }

    // MARK: - Server URL normalization

    /// Accepts user input such as "192.168.1.10:8096", "http://nas.local:8096/", " https://x.y/hc/ "
    /// and returns a normalized base URL without a trailing slash, or nil if invalid.
    static func normalizeServerURL(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") {
            if s.contains("://") { return nil } // some other scheme
            s = "http://" + s
        }
        while s.hasSuffix("/") { s.removeLast() }
        guard var comps = URLComponents(string: s),
              let scheme = comps.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = comps.host, !host.isEmpty else { return nil }
        comps.scheme = scheme
        comps.query = nil
        comps.fragment = nil
        // If the user pasted ".../api", strip it; the builder appends /api itself.
        if comps.path.lowercased().hasSuffix("/api") {
            comps.path = String(comps.path.dropLast(4))
        }
        return comps.url
    }

    // MARK: - Generic builder

    /// Builds `<base>/<segments...>` with each segment strictly percent-encoded (so "/" inside a
    /// series name stays part of one segment), plus optional query items.
    func url(_ segments: [String], query: [URLQueryItem] = [], includeToken: Bool = false) -> URL {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        var basePath = comps.percentEncodedPath
        while basePath.hasSuffix("/") { basePath.removeLast() }
        let encoded = segments.map(Self.encodeSegment).joined(separator: "/")
        comps.percentEncodedPath = basePath + "/" + encoded

        var items = query
        if includeToken, let token, !token.isEmpty {
            items.append(URLQueryItem(name: "token", value: token))
        }
        if items.isEmpty {
            comps.percentEncodedQuery = nil
        } else {
            comps.queryItems = items
            // URLComponents leaves "+" unescaped; most servers decode it as a space.
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        return comps.url!
    }

    static let segmentAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-._~")
        return set
    }()

    static func encodeSegment(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: segmentAllowed) ?? s
    }

    // MARK: - Media URLs (token in query, for players / image loaders)

    func streamURL(_ id: String) -> URL {
        url(["api", "media", id, "stream"], includeToken: true)
    }

    func hlsURL(_ id: String, start: Double? = nil) -> URL {
        var q: [URLQueryItem] = []
        if let start, start > 0 {
            q.append(URLQueryItem(name: "start", value: String(Int(start.rounded(.down)))))
        }
        return url(["api", "media", id, "transcode.m3u8"], query: q, includeToken: true)
    }

    func thumbnailURL(_ id: String, width: Int? = nil) -> URL {
        var q: [URLQueryItem] = []
        if let width { q.append(URLQueryItem(name: "w", value: String(width))) }
        return url(["api", "media", id, "thumbnail"], query: q, includeToken: true)
    }

    func subtitleURL(itemId: String, subId: String) -> URL {
        url(["api", "media", itemId, "subtitles", subId], includeToken: true)
    }

    /// Best image to show in a card for an item (nil = show placeholder icon).
    func artworkURL(for item: MediaItem, width: Int = 400) -> URL? {
        if item.hasThumbnail { return thumbnailURL(item.id, width: width) }
        if item.kind == .image { return streamURL(item.id) }
        return nil
    }

    // MARK: - Playback rule (docs/API.md "Client playback rule", iOS branch)

    /// iOS: `stream` when directPlayable, otherwise HLS transcode. Audio/images are always streamed.
    func playback(for item: MediaItem, startAt: Double? = nil) -> PlaybackSource {
        if item.directPlayable || item.kind != .video {
            return PlaybackSource(url: streamURL(item.id), isHLS: false, timeOffset: 0)
        }
        // On-the-fly HLS: start transcoding at the resume point; the player timeline then begins at 0,
        // so callers must add `timeOffset` to the player's current time when reporting progress.
        let start = (startAt ?? 0) > 0 ? floor(startAt!) : 0
        return PlaybackSource(url: hlsURL(item.id, start: start), isHLS: true, timeOffset: start)
    }
}

struct PlaybackSource: Equatable, Sendable {
    let url: URL
    let isHLS: Bool
    /// Seconds of media time that precede player time 0 (non-zero only for HLS started with `start`).
    let timeOffset: Double
}
