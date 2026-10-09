import XCTest
@testable import HomeCentre

final class VTTParserTests: XCTestCase {
    func testParsesBasicDocument() {
        let vtt = """
        WEBVTT

        1
        00:00:01.000 --> 00:00:04.000
        Hello, <i>world</i>!

        00:05.500 --> 00:07.250 align:start position:10%
        <v Bob>Second line</v>
        continues here

        NOTE this is a comment
        that spans lines

        01:00:00.000 --> 01:00:02.000
        Tom &amp; Jerry &lt;3
        """
        let cues = VTTParser.parse(vtt)
        XCTAssertEqual(cues.count, 3)
        XCTAssertEqual(cues[0], SubtitleCue(start: 1, end: 4, text: "Hello, world!"))
        XCTAssertEqual(cues[1].start, 5.5, accuracy: 0.0001)
        XCTAssertEqual(cues[1].end, 7.25, accuracy: 0.0001)
        XCTAssertEqual(cues[1].text, "Second line\ncontinues here")
        XCTAssertEqual(cues[2].start, 3600)
        XCTAssertEqual(cues[2].text, "Tom & Jerry <3")
    }

    func testHandlesCRLFAndBOMAndCommaDecimals() {
        let vtt = "\u{FEFF}WEBVTT\r\n\r\n00:00:02,500 --> 00:00:03,000\r\nComma style\r\n"
        let cues = VTTParser.parse(vtt)
        XCTAssertEqual(cues.count, 1)
        XCTAssertEqual(cues[0].start, 2.5, accuracy: 0.0001)
        XCTAssertEqual(cues[0].text, "Comma style")
    }

    func testSkipsStyleBlocksAndMalformedCues() {
        let vtt = """
        WEBVTT

        STYLE
        ::cue { color: yellow }

        garbage --> nonsense
        should be skipped

        00:00:10.000 --> 00:00:11.000
        Valid
        """
        let cues = VTTParser.parse(vtt)
        XCTAssertEqual(cues.map(\.text), ["Valid"])
    }

    func testActiveCueLookup() {
        let cues = [
            SubtitleCue(start: 1, end: 3, text: "A"),
            SubtitleCue(start: 2, end: 5, text: "B"),
            SubtitleCue(start: 10, end: 12, text: "C"),
        ]
        XCTAssertNil(VTTParser.text(at: 0.5, in: cues))
        XCTAssertEqual(VTTParser.text(at: 1.5, in: cues), "A")
        XCTAssertEqual(VTTParser.text(at: 2.5, in: cues), "A\nB")
        XCTAssertEqual(VTTParser.text(at: 4, in: cues), "B")
        XCTAssertNil(VTTParser.text(at: 7, in: cues))
        XCTAssertEqual(VTTParser.text(at: 11, in: cues), "C")
        XCTAssertNil(VTTParser.text(at: 12, in: cues), "end time is exclusive")
        XCTAssertNil(VTTParser.text(at: 1, in: []))
    }

    func testTimestampParsing() {
        XCTAssertEqual(VTTParser.parseTimestamp("00:00:01.000"), 1)
        XCTAssertEqual(VTTParser.parseTimestamp("01:02:03.500"), 3723.5)
        XCTAssertEqual(VTTParser.parseTimestamp("02:03.250"), 123.25)
        XCTAssertNil(VTTParser.parseTimestamp("abc"))
        XCTAssertNil(VTTParser.parseTimestamp("1.5"))
    }
}
