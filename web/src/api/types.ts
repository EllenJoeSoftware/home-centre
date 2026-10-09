/**
 * Types mirroring docs/API.md exactly. Keep in sync with the contract.
 */

export type MediaKind = "video" | "audio" | "image";

export interface SubtitleTrack {
  id: string;
  language: string | null;
  label: string;
  format: "srt" | "vtt";
}

export interface Progress {
  positionSec: number;
  completed: boolean;
  updatedAt: string;
}

export interface SeriesRef {
  name: string;
  season: number;
  episode: number;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  fileName: string;
  relativePath: string;
  libraryId: string;
  folder: string;
  size: number;
  mimeType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  directPlayable: boolean;
  series: SeriesRef | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  addedAt: string;
  modifiedAt: string;
  hasThumbnail: boolean;
  subtitles: SubtitleTrack[];
  progress: Progress | null;
}

export interface Library {
  id: string;
  name: string;
  path: string;
  itemCount: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface Health {
  status: "ok";
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface ScanStatus {
  running: boolean;
  lastScanAt: string | null;
  itemCount: number;
}

export interface FolderEntry {
  name: string;
  path: string;
}

export interface FolderListing {
  path: string;
  folders: FolderEntry[];
  items: MediaItem[];
}

export interface Series {
  name: string;
  episodeCount: number;
  seasons: number[];
  thumbnailItemId: string | null;
}

export type SortField = "title" | "added" | "modified" | "size" | "duration";
export type SortOrder = "asc" | "desc";

export interface MediaQuery {
  kind?: MediaKind;
  libraryId?: string;
  folder?: string;
  q?: string;
  sort?: SortField;
  order?: SortOrder;
  offset?: number;
  limit?: number;
}

export interface ProgressUpdate {
  positionSec: number;
  completed?: boolean;
}

export interface NewUser {
  username: string;
  password: string;
  isAdmin: boolean;
}

export interface ApiErrorBody {
  error: string;
}
