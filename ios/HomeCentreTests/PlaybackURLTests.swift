import XCTest
@testable import HomeCentre

final class PlaybackURLTests: XCTestCase {
    private let base = URL(string: "http://192.168.1.10:8096")!
    private lazy var urls = MediaURLBuilder(baseURL: base, token: "hdr.payload.sig")

    private func item(_ json: String = ModelDecodingTests.fullItemJSON, directPlayable: Bool, kind: String = "video") throws -> MediaItem {
        var s = json.replacingOccurrences(of: "\"directPlayable\": true", with: "\"directPlayable\": \(directPlayable)")
        s = s.replacingOccurrences(of: "\"directPlayable\": false", with: "\"directPlayable\": \(directPlayable)")
        s = s.replacingOccurrences(of: "\"kind\": \"video\"", with: "\"kind\": \"\(kind)\"")
        return try JSONDecoder().decode(MediaItem.self, from: Data(s.utf8))
    }

    func testDirectPlayableUsesStream() throws {
        let src = urls.playback(for: try item(directPlayable: true))
        XCTAssertFalse(src.isHLS)
        XCTAssertEqual(src.timeOffset, 0)
        XCTAssertEqual(src.url.absoluteString,
                       "http://192.168.1.10:8096/api/media/fedcba9876543210/stream?token=hdr.payload.sig")
    }

    func testDirectPlayableResumeDoesNotChangeURL() throws {
        let src = urls.playback(for: try item(directPlayable: true), startAt: 600)
        XCTAssertFalse(src.isHLS)
        XCTAssertEqual(src.timeOffset, 0, "progressive playback seeks in the player instead")
    }

    func testNonDirectVideoUsesHLS() throws {
        let src = urls.playback(for: try item(directPlayable: false))
        XCTAssertTrue(src.isHLS)
        XCTAssertEqual(src.url.absoluteString,
                       "http://192.168.1.10:8096/api/media/fedcba9876543210/transcode.m3u8?token=hdr.payload.sig")
    }

    func testHLSResumePassesStartAndOffset() throws {
        let src = urls.playback(for: try item(directPlayable: false), startAt: 600.7)
        XCTAssertTrue(src.isHLS)
        XCTAssertEqual(src.timeOffset, 600)
        let comps = URLComponents(url: src.url, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(comps.path, "/api/media/fedcba9876543210/transcode.m3u8")
        XCTAssertEqual(comps.queryItems?.first { $0.name == "start" }?.value, "600")
        XCTAssertEqual(comps.queryItems?.first { $0.name == "token" }?.value, "hdr.payload.sig")
    }

    func testNonDirectAudioStillStreams() throws {
        let src = urls.playback(for: try item(directPlayable: false, kind: "audio"))
        XCTAssertFalse(src.isHLS)
        XCTAssertTrue(src.url.path.hasSuffix("/stream"))
    }

    func testThumbnailAndSubtitleURLs() {
        XCTAssertEqual(urls.thumbnailURL("abc", width: 400).absoluteString,
                       "http://192.168.1.10:8096/api/media/abc/thumbnail?w=400&token=hdr.payload.sig")
        XCTAssertEqual(urls.subtitleURL(itemId: "abc", subId: "s0").absoluteString,
                       "http://192.168.1.10:8096/api/media/abc/subtitles/s0?token=hdr.payload.sig")
    }

    func testPathSegmentsAreStrictlyEncoded() {
        let url = urls.url(["api", "series", "Law & Order: SVU / Part 2", "episodes"])
        XCTAssertEqual(url.absoluteString,
                       "http://192.168.1.10:8096/api/series/Law%20%26%20Order%3A%20SVU%20%2F%20Part%202/episodes")
    }

    func testPlusInQueryIsEscaped() {
        let url = urls.url(["api", "media"], query: [URLQueryItem(name: "q", value: "C++ tips")])
        XCTAssertEqual(url.query, "q=C%2B%2B%20tips")
    }

    func testBaseURLWithSubpath() {
        let b = MediaURLBuilder(baseURL: URL(string: "https://example.com/homecentre")!, token: nil)
        XCTAssertEqual(b.streamURL("x").absoluteString, "https://example.com/homecentre/api/media/x/stream")
    }

    func testServerURLNormalization() {
        XCTAssertEqual(MediaURLBuilder.normalizeServerURL("192.168.1.10:8096")?.absoluteString, "http://192.168.1.10:8096")
        XCTAssertEqual(MediaURLBuilder.normalizeServerURL("  http://nas.local:8096/  ")?.absoluteString, "http://nas.local:8096")
        XCTAssertEqual(MediaURLBuilder.normalizeServerURL("HTTPS://media.example.com/api/")?.absoluteString, "https://media.example.com")
        XCTAssertNil(MediaURLBuilder.normalizeServerURL(""))
        XCTAssertNil(MediaURLBuilder.normalizeServerURL("ftp://x"))
    }
}
