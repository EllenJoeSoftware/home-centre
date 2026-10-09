import Foundation

// Mirrors docs/API.md "Common types" exactly. Nullable fields are Optionals;
// synthesized Decodable uses decodeIfPresent, so both `null` and a missing key decode to nil.

enum MediaKind: String, Codable, Hashable, CaseIterable, Sendable {
    case video
    case audio
    case image
}

enum SubtitleFormat: String, Codable, Hashable, Sendable {
    case srt
    case vtt
}

struct SeriesInfo: Codable, Hashable, Sendable {
    let name: String
    let season: Int
    let episode: Int
}

struct SubtitleTrack: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let language: String?
    let label: String
    let format: SubtitleFormat
}

struct MediaProgress: Codable, Hashable, Sendable {
    let positionSec: Double
    let completed: Bool
    let updatedAt: String
}

struct MediaItem: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let kind: MediaKind
    let title: String
    let fileName: String
    let relativePath: String
    let libraryId: String
    let folder: String
    let size: Int64
    let mimeType: String
    let durationSec: Double?
    let width: Int?
    let height: Int?
    let videoCodec: String?
    let audioCodec: String?
    let container: String?
    let directPlayable: Bool
    let series: SeriesInfo?
    let artist: String?
    let album: String?
    let year: Int?
    let addedAt: String
    let modifiedAt: String
    let hasThumbnail: Bool
    let subtitles: [SubtitleTrack]
    let progress: MediaProgress?
}

extension MediaItem {
    /// Position to offer in the "Resume" prompt, or nil if the item should start from the beginning.
    var resumePosition: Double? {
        guard let p = progress, !p.completed, p.positionSec > 5 else { return nil }
        if let d = durationSec, d > 0, p.positionSec >= d * 0.95 { return nil }
        return p.positionSec
    }

    /// 0...1 fraction watched, for progress bars.
    var progressFraction: Double? {
        guard let p = progress, let d = durationSec, d > 0 else { return nil }
        if p.completed { return 1 }
        return min(max(p.positionSec / d, 0), 1)
    }

    var subtitleLine: String? {
        if let s = series {
            return String(format: "S%02dE%02d", s.season, s.episode)
        }
        switch kind {
        case .audio:
            return [artist, album].compactMap { $0 }.joined(separator: " · ").nilIfEmpty
        case .video:
            return year.map(String.init)
        case .image:
            return nil
        }
    }
}

struct Library: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let path: String
    let itemCount: Int
}

struct Page<T: Codable & Sendable>: Codable, Sendable {
    let items: [T]
    let total: Int
    let offset: Int
    let limit: Int
}

struct User: Codable, Hashable, Sendable {
    let id: Int
    let username: String
    let isAdmin: Bool
}

struct LoginRequest: Codable, Sendable {
    let username: String
    let password: String
}

struct LoginResponse: Codable, Sendable {
    let token: String
    let user: User
}

struct ServerInfo: Codable, Sendable {
    /// "home-centre" on every Home Centre server (older servers may omit it).
    let product: String?
    /// Stable server UUID, used to de-duplicate LAN discovery results.
    let id: String?
    let name: String
    let version: String

    static let productIdentifier = "home-centre"

    var isHomeCentre: Bool { product == Self.productIdentifier }
}

struct HealthResponse: Codable, Sendable {
    let status: String
}

struct ScanStatus: Codable, Sendable {
    let running: Bool
    let lastScanAt: String?
    let itemCount: Int
}

struct ScanStarted: Codable, Sendable {
    let started: Bool
}

struct FolderEntry: Codable, Hashable, Identifiable, Sendable {
    let name: String
    let path: String
    var id: String { path }
}

struct FolderListing: Codable, Sendable {
    let path: String
    let folders: [FolderEntry]
    let items: [MediaItem]
}

struct SeriesSummary: Codable, Hashable, Identifiable, Sendable {
    let name: String
    let episodeCount: Int
    let seasons: [Int]
    let thumbnailItemId: String?
    var id: String { name }
}

struct ProgressUpdate: Codable, Sendable {
    let positionSec: Double
    let completed: Bool?
}

struct ErrorResponse: Codable, Sendable {
    let error: String
}

enum MediaSort: String, CaseIterable, Sendable {
    case title, added, modified, size, duration
}

enum MediaSortOrder: String, Sendable {
    case asc, desc
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
