import Foundation

struct SubtitleCue: Equatable, Sendable {
    let start: Double
    let end: Double
    let text: String
}

/// Minimal WebVTT parser (the server always returns WebVTT, converting SRT on the fly).
/// Tolerates CRLF, BOM, missing hours, comma decimal separators, cue identifiers, cue settings,
/// NOTE/STYLE/REGION blocks and inline tags (<i>, <b>, <c.x>, <v Name>, <00:00:01.000>).
enum VTTParser {
    static func parse(_ input: String) -> [SubtitleCue] {
        var text = input.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }

        let blocks = text.components(separatedBy: "\n\n")
        var cues: [SubtitleCue] = []

        for block in blocks {
            var lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            while let first = lines.first, first.trimmingCharacters(in: .whitespaces).isEmpty { lines.removeFirst() }
            guard let first = lines.first else { continue }
            if first.hasPrefix("WEBVTT") || first.hasPrefix("NOTE") || first.hasPrefix("STYLE") || first.hasPrefix("REGION") {
                continue
            }
            guard let timingIndex = lines.firstIndex(where: { $0.contains("-->") }), timingIndex <= 1 else { continue }
            guard let (start, end) = parseTiming(lines[timingIndex]) else { continue }
            let body = lines[(timingIndex + 1)...]
                .map { stripTags($0) }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty else { continue }
            cues.append(SubtitleCue(start: start, end: end, text: body))
        }
        return cues.sorted { $0.start < $1.start }
    }

    /// Text of all cues active at `time`, joined by newlines (nil if none).
    static func text(at time: Double, in cues: [SubtitleCue]) -> String? {
        // Binary search for the last cue starting at or before `time`, then scan back for overlaps.
        var lo = 0, hi = cues.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if cues[mid].start <= time { lo = mid + 1 } else { hi = mid }
        }
        var active: [String] = []
        var i = lo - 1
        while i >= 0 {
            let cue = cues[i]
            if time < cue.end { active.insert(cue.text, at: 0) }
            // Cues rarely exceed 30s; stop scanning far-back cues.
            if time - cue.start > 30 { break }
            i -= 1
        }
        return active.isEmpty ? nil : active.joined(separator: "\n")
    }

    static func parseTiming(_ line: String) -> (Double, Double)? {
        let parts = line.components(separatedBy: "-->")
        guard parts.count == 2 else { return nil }
        let startStr = parts[0].trimmingCharacters(in: .whitespaces)
        // End time is followed by optional cue settings ("align:start position:10%").
        let endStr = parts[1].trimmingCharacters(in: .whitespaces)
            .split(separator: " ", omittingEmptySubsequences: true).first.map(String.init) ?? ""
        guard let s = parseTimestamp(startStr), let e = parseTimestamp(endStr) else { return nil }
        return (s, e)
    }

    /// "hh:mm:ss.ttt" or "mm:ss.ttt" (comma accepted as decimal separator).
    static func parseTimestamp(_ raw: String) -> Double? {
        let s = raw.replacingOccurrences(of: ",", with: ".")
        let comps = s.split(separator: ":").map(String.init)
        guard comps.count == 2 || comps.count == 3 else { return nil }
        var total = 0.0
        for (idx, c) in comps.enumerated() {
            guard let v = Double(c), v >= 0 else { return nil }
            if idx < comps.count - 1 { total = (total + v) * 60 } else { total += v }
        }
        return total
    }

    static func stripTags(_ line: String) -> String {
        var out = ""
        var inTag = false
        for ch in line {
            if ch == "<" { inTag = true; continue }
            if ch == ">" && inTag { inTag = false; continue }
            if !inTag { out.append(ch) }
        }
        return out
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: "\u{00A0}")
            .replacingOccurrences(of: "&lrm;", with: "")
            .replacingOccurrences(of: "&rlm;", with: "")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}
