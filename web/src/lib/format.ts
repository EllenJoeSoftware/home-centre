import type { MediaItem, SeriesRef } from "../api/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** 65 -> "1:05", 3725 -> "1:02:05". Invalid/negative -> "0:00". */
export function formatTime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Human runtime: 6300 -> "1h 45m", 300 -> "5m", 42 -> "42s". */
export function formatRuntime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatEpisode(s: Pick<SeriesRef, "season" | "episode">): string {
  return `S${pad(s.season)}E${pad(s.episode)}`;
}

export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  const h = Math.min(width, height) === height ? height : width;
  if (width >= 3800 || h >= 2100) return "4K";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 560) return "576p";
  return "SD";
}

/** Fraction 0..1 watched for an item, or null when there's nothing to show. */
export function progressFraction(item: Pick<MediaItem, "progress" | "durationSec">): number | null {
  const p = item.progress;
  if (!p || p.completed || !item.durationSec || item.durationSec <= 0) return null;
  if (p.positionSec <= 0) return null;
  return Math.max(0, Math.min(1, p.positionSec / item.durationSec));
}

/** Whether the resume prompt should be offered. */
export function shouldOfferResume(item: Pick<MediaItem, "progress" | "durationSec">): boolean {
  const p = item.progress;
  if (!p || p.completed || p.positionSec < 10) return false;
  if (item.durationSec && p.positionSec > item.durationSec - 15) return false;
  return true;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (Number.isNaN(diff)) return "";
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return formatDate(iso);
}

/** Secondary line under a card title. */
export function itemSubtitle(item: MediaItem): string {
  if (item.series) return `${formatEpisode(item.series)} · ${item.series.name}`;
  if (item.kind === "audio") return [item.artist, item.album].filter(Boolean).join(" · ") || formatRuntime(item.durationSec);
  if (item.kind === "image") return formatDate(item.modifiedAt);
  return [item.year, formatRuntime(item.durationSec)].filter(Boolean).join(" · ");
}

/** Stable hue derived from a string, for placeholder artwork. */
export function hueFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  // Keep within cool, on-brand range: teal -> blue -> indigo -> violet.
  return 160 + (h % 110);
}
