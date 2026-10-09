import { describe, expect, it } from "vitest";
import { formatBytes, formatEpisode, formatRuntime, formatTime, progressFraction, resolutionLabel, shouldOfferResume } from "./format";

describe("formatTime", () => {
  it("formats minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(59.9)).toBe("0:59");
  });
  it("formats hours", () => {
    expect(formatTime(3725)).toBe("1:02:05");
  });
  it("handles invalid input", () => {
    expect(formatTime(null)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});

describe("formatRuntime / formatBytes / episodes", () => {
  it("runtime", () => {
    expect(formatRuntime(6300)).toBe("1h 45m");
    expect(formatRuntime(7200)).toBe("2h");
    expect(formatRuntime(300)).toBe("5m");
    expect(formatRuntime(null)).toBe("");
  });
  it("bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(4.2 * 1024 ** 3)).toBe("4.2 GB");
  });
  it("episode", () => {
    expect(formatEpisode({ season: 1, episode: 2 })).toBe("S01E02");
  });
  it("resolution", () => {
    expect(resolutionLabel(1920, 1080)).toBe("1080p");
    expect(resolutionLabel(3840, 2160)).toBe("4K");
    expect(resolutionLabel(null, null)).toBeNull();
  });
});

describe("progress helpers", () => {
  const p = (positionSec: number, completed = false) => ({ positionSec, completed, updatedAt: "2024-01-01T00:00:00Z" });
  it("fraction", () => {
    expect(progressFraction({ progress: p(50), durationSec: 100 })).toBe(0.5);
    expect(progressFraction({ progress: p(50, true), durationSec: 100 })).toBeNull();
    expect(progressFraction({ progress: null, durationSec: 100 })).toBeNull();
  });
  it("resume offer", () => {
    expect(shouldOfferResume({ progress: p(600), durationSec: 3600 })).toBe(true);
    expect(shouldOfferResume({ progress: p(3), durationSec: 3600 })).toBe(false);
    expect(shouldOfferResume({ progress: p(3595), durationSec: 3600 })).toBe(false);
  });
});
