import XCTest
@testable import HomeCentre

final class ModelDecodingTests: XCTestCase {
    private let decoder = JSONDecoder()

    /// A video with every nullable field set to null.
    static let sparseItemJSON = """
    {
      "id": "0123456789abcdef",
      "kind": "video",
      "title": "Holiday Clip",
      "fileName": "holiday_clip.mkv",
      "relativePath": "Videos/holiday_clip.mkv",
      "libraryId": "lib1",
      "folder": "Videos",
      "size": 5368709120,
      "mimeType": "video/x-matroska",
      "durationSec": null,
      "width": null,
      "height": null,
      "videoCodec": null,
      "audioCodec": null,
      "container": null,
      "directPlayable": false,
      "series": null,
      "artist": null,
      "album": null,
      "year": null,
      "addedAt": "2026-10-01T12:00:00.000Z",
      "modifiedAt": "2026-09-30T08:15:00Z",
      "hasThumbnail": false,
      "subtitles": [],
      "progress": null
    }
    """

    /// A TV episode with all optional fields populated.
    static let fullItemJSON = """
    {
      "id": "fedcba9876543210",
      "kind": "video",
      "title": "Pilot",
      "fileName": "Show.S01E02.mp4",
      "relativePath": "TV/Show/Show.S01E02.mp4",
      "libraryId": "lib1",
      "folder": "TV/Show",
      "size": 734003200,
      "mimeType": "video/mp4",
      "durationSec": 2640.5,
      "width": 1920,
      "height": 1080,
      "videoCodec": "h264",
      "audioCodec": "aac",
      "container": "mp4",
      "directPlayable": true,
      "series": { "name": "Show", "season": 1, "episode": 2 },
      "artist": null,
      "album": null,
      "year": 2024,
      "addedAt": "2026-10-01T12:00:00.000Z",
      "modifiedAt": "2026-09-30T08:15:00Z",
      "hasThumbnail": true,
      "subtitles": [
        { "id": "s0", "language": "en", "label": "English", "format": "srt" },
        { "id": "s1", "language": null, "label": "Show.S01E02.vtt", "format": "vtt" }
      ],
      "progress": { "positionSec": 600, "completed": false, "updatedAt": "2026-10-02T20:00:00Z" }
    }
    """

    func testDecodesItemWithNulls() throws {
        let item = try decoder.decode(MediaItem.self, from: Data(Self.sparseItemJSON.utf8))
        XCTAssertEqual(item.id, "0123456789abcdef")
        XCTAssertEqual(item.kind, .video)
        XCTAssertEqual(item.size, 5_368_709_120)
        XCTAssertNil(item.durationSec)
        XCTAssertNil(item.width)
        XCTAssertNil(item.height)
        XCTAssertNil(item.videoCodec)
        XCTAssertNil(item.container)
        XCTAssertNil(item.series)
        XCTAssertNil(item.artist)
        XCTAssertNil(item.year)
        XCTAssertNil(item.progress)
        XCTAssertFalse(item.directPlayable)
        XCTAssertTrue(item.subtitles.isEmpty)
        XCTAssertNil(item.resumePosition)
        XCTAssertNil(item.progressFraction)
    }

    func testDecodesFullEpisode() throws {
        let item = try decoder.decode(MediaItem.self, from: Data(Self.fullItemJSON.utf8))
        XCTAssertEqual(item.series, SeriesInfo(name: "Show", season: 1, episode: 2))
        XCTAssertEqual(item.durationSec, 2640.5)
        XCTAssertEqual(item.width, 1920)
        XCTAssertEqual(item.subtitles.count, 2)
        XCTAssertEqual(item.subtitles[0].format, .srt)
        XCTAssertNil(item.subtitles[1].language)
        XCTAssertEqual(item.subtitles[1].format, .vtt)
        XCTAssertEqual(item.progress?.positionSec, 600)
        XCTAssertEqual(item.resumePosition, 600)
        XCTAssertEqual(item.subtitleLine, "S01E02")
        XCTAssertEqual(item.progressFraction ?? 0, 600 / 2640.5, accuracy: 0.0001)
    }

    func testDecodesPage() throws {
        let json = """
        { "items": [\(Self.sparseItemJSON), \(Self.fullItemJSON)], "total": 120, "offset": 50, "limit": 50 }
        """
        let page = try decoder.decode(Page<MediaItem>.self, from: Data(json.utf8))
        XCTAssertEqual(page.items.count, 2)
        XCTAssertEqual(page.total, 120)
        XCTAssertEqual(page.offset, 50)
    }

    func testDecodesOtherContractTypes() throws {
        let login = try decoder.decode(LoginResponse.self, from: Data("""
        { "token": "a.b.c", "user": { "id": 1, "username": "admin", "isAdmin": true } }
        """.utf8))
        XCTAssertEqual(login.user.username, "admin")
        XCTAssertTrue(login.user.isAdmin)

        let folders = try decoder.decode(FolderListing.self, from: Data("""
        { "path": "Music", "folders": [ { "name": "Album", "path": "Music/Album" } ], "items": [] }
        """.utf8))
        XCTAssertEqual(folders.folders.first?.path, "Music/Album")

        let series = try decoder.decode([SeriesSummary].self, from: Data("""
        [ { "name": "Show", "episodeCount": 10, "seasons": [1, 2], "thumbnailItemId": null } ]
        """.utf8))
        XCTAssertNil(series.first?.thumbnailItemId)

        let status = try decoder.decode(ScanStatus.self, from: Data("""
        { "running": false, "lastScanAt": null, "itemCount": 0 }
        """.utf8))
        XCTAssertNil(status.lastScanAt)

        // GET /progress may return a bare JSON null.
        let none = try decoder.decode(MediaProgress?.self, from: Data("null".utf8))
        XCTAssertNil(none)
    }

    func testCompletedProgressDoesNotResume() throws {
        let json = Self.fullItemJSON.replacingOccurrences(of: "\"completed\": false", with: "\"completed\": true")
        let item = try decoder.decode(MediaItem.self, from: Data(json.utf8))
        XCTAssertNil(item.resumePosition)
        XCTAssertEqual(item.progressFraction, 1)
    }
}
