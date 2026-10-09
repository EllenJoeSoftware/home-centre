# Home Centre — Architecture & API Contract

This is the single source of truth every component follows. Do not deviate without updating this file.

## Repository layout

```
home-centre/
  server/            Node 22 + TypeScript + Fastify + SQLite (better-sqlite3). Dockerfile.
  web/               React 18 + Vite + TypeScript SPA. Dockerfile (nginx, proxies /api to server).
  android/           One Gradle project (Kotlin, Jetpack Compose, Media3 ExoPlayer):
                       :core      shared API client, models, settings (Android library)
                       :mobile    phone/tablet app   (applicationId com.ellenjoe.homecentre)
                       :tv        Android TV box app (applicationId com.ellenjoe.homecentre.tv, Leanback launcher)
  ios/               SwiftUI iPhone app, XcodeGen project.yml (no checked-in .xcodeproj).
  docker-compose.yml server + web
  .github/workflows/ server.yml, web.yml, android.yml, ios.yml
  docs/API.md        this file
```

## Server basics

- Listens on port **8096** (env `PORT`). Base path for API: `/api`.
- Env vars: `MEDIA_DIRS` (comma-separated absolute paths, default `/media`; **first-run seed only**, see Libraries), `BROWSE_ROOTS` (comma-separated absolute paths, default `/media,/host`; the only trees the admin folder browser may show and libraries may point into; roots that do not exist are skipped), `DATA_DIR` (default `/data`, holds `homecentre.db` and `cache/`), `ADMIN_USER` (default `admin`), `ADMIN_PASSWORD` (default `admin` — logs a warning), `JWT_SECRET` (if unset, generated once and persisted in DATA_DIR), `SCAN_INTERVAL_MINUTES` (default 60, 0 disables), `FFMPEG_PATH`/`FFPROBE_PATH` (default `ffmpeg`/`ffprobe` on PATH), `CORS_ORIGIN` (default `*`).
- Docker image contains ffmpeg. Volumes: `/media` (read-only), `/host` (read-only, the folder tree offered by the folder picker) and `/data`.
- Scans every library on startup and on interval; probes with ffprobe (duration, width, height, codecs). Extracts video thumbnail (frame at 10% duration) to `DATA_DIR/cache/thumbs/<id>.jpg`. Uses embedded cover art for audio if present.
- Media kinds by extension:
  - video: mp4 m4v mkv avi mov webm wmv flv ts m2ts mpg mpeg 3gp
  - audio: mp3 flac m4a aac ogg opus wav wma alac
  - image: jpg jpeg png gif webp bmp heic
- Sidecar subtitles: `<basename>.srt` / `<basename>.vtt` / `<basename>.<lang>.srt` next to the video.
- TV-series detection from filename/folder: `S01E02`, `1x02`. Movies: everything else under video.
- IDs are stable: sha1 of absolute path, hex, first 16 chars.

## Libraries (media folders)

- Libraries are persisted in SQLite (`libraries` table: `id`, `name`, `path` UNIQUE, `created_at`). The DB is the source of truth; the scanner reads it on every scan.
- On the very first start (empty table, never seeded before) the table is seeded from `MEDIA_DIRS`: `id` = sha1(path) first 16 hex chars (same scheme as before, so existing media rows and client-held ids stay valid), `name` = basename of the path (`"Media"` for `/media`). Removing every library later does not re-seed.
- Admins add / change / remove libraries at runtime (endpoints below). New libraries get `id` = sha1(path) as well (a suffix is added in the rare case that id is taken). Changing a library's path **keeps its id**, drops its media rows (with their progress and cached thumbnails) and rescans.
- A library path must be an existing, readable directory inside `BROWSE_ROOTS` (checked after `fs.realpath`, so `..` and symlinks cannot escape → `403`), must not already be a library and must not be inside or contain another library (`400` with a message saying which). The same folder visible under two mount points (same device + inode) counts as the same folder.
- Every library change triggers a background scan; if one is already running, exactly one more pass is queued after it (never two at once).

## Authentication

- `POST /api/auth/login` body `{ "username": "...", "password": "..." }` → `200 { "token": "<jwt>", "user": { "id": 1, "username": "admin", "isAdmin": true } }`, `401` on bad credentials.
- All other `/api/*` endpoints (except `/api/health` and `/api/server/info`) require `Authorization: Bearer <token>`.
- Streaming / image endpoints ALSO accept `?token=<jwt>` query param (needed by `<video src>`, ExoPlayer, AVPlayer, image loaders).
- JWT lifetime 30 days.

## Common types (JSON, camelCase)

```ts
type MediaKind = "video" | "audio" | "image";

interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;            // cleaned from filename
  fileName: string;
  relativePath: string;     // relative to its media root
  libraryId: string;        // which media root
  folder: string;           // relative folder path, "" for root
  size: number;             // bytes
  mimeType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;  // e.g. "mp4", "matroska"
  directPlayable: boolean;   // mp4/m4v/webm/mov with h264|hevc|vp9|av1 + aac|mp3|opus, or mp3/m4a/aac/ogg/opus/wav/flac audio
  series: { name: string; season: number; episode: number } | null;
  artist: string | null; album: string | null; year: number | null;
  addedAt: string;           // ISO 8601
  modifiedAt: string;
  hasThumbnail: boolean;
  subtitles: { id: string; language: string | null; label: string; format: "srt" | "vtt" }[];
  progress: { positionSec: number; completed: boolean; updatedAt: string } | null; // for current user
}

interface Library { id: string; name: string; path: string; itemCount: number; }

interface Page<T> { items: T[]; total: number; offset: number; limit: number; }

// Admin folder browser
interface BrowseRoot { name: string; path: string; }        // name = basename ("Media" for /media)
interface BrowseDir { name: string; path: string; mediaCount: number; } // media files directly inside (no recursion)
interface BrowseListing {
  path: string;              // canonical absolute path (symlinks resolved, expressed under its root)
  parent: string | null;     // null when `path` is a root
  dirs: BrowseDir[];         // sub-folders only; sorted case-insensitively; dot-folders, system folders
                             // (@eaDir, $RECYCLE.BIN, …), unreadable folders and symlinks leaving the roots skipped
  mediaFiles: number;        // media files directly inside `path` (no recursion)
  truncated: boolean;        // true when more than 1000 sub-folders exist (only the first 1000 are returned)
}
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ "status": "ok" }` no auth |
| GET | `/api/server/info` | `{ "product": "home-centre", "id": "<uuid>", "name": "Home Centre", "version": "1.0.0" }` no auth (used by clients to validate server URL and by discovery). `id` is a stable UUID persisted in DATA_DIR; `name` comes from `SERVER_NAME` (default "Home Centre"). Clients identify a Home Centre server by `product == "home-centre"`. |
| POST | `/api/auth/login` | see above |
| GET | `/api/me` | current user |
| GET | `/api/libraries` | `Library[]` (from the DB, in creation order) |
| POST | `/api/libraries` | admin; body `{ "path": string, "name"?: string }` → `201 Library`. Validated as described under Libraries (`400` invalid/missing/duplicate/nested, `403` outside `BROWSE_ROOTS`). Starts a background scan. |
| PATCH | `/api/libraries/:id` | admin; body `{ "name"?: string, "path"?: string }` → `Library`. Same validation. A new path keeps the id, removes the library's media (+ progress, thumbnails) and rescans. `404` unknown id. |
| DELETE | `/api/libraries/:id` | admin; → `{ "deleted": true }`. Removes the library, its media, their progress and cached thumbnails. Files on disk are untouched. `404` unknown id. |
| POST | `/api/libraries/scan` | admin; triggers rescan, returns `202 { "started": true }` |
| GET | `/api/fs/roots` | admin; `{ "roots": BrowseRoot[] }`, existing `BROWSE_ROOTS` only |
| GET | `/api/fs/browse` | admin; query `path` (absolute, required) → `BrowseListing`. `400` missing/relative path or not a folder, `403` outside `BROWSE_ROOTS` (including via `..` or symlinks), `404` missing folder |
| GET | `/api/scan/status` | `{ "running": bool, "lastScanAt": string|null, "itemCount": number }` |
| GET | `/api/media` | query: `kind`, `libraryId`, `folder`, `q` (search title/filename/artist/album), `sort` = `title`\|`added`\|`modified`\|`size`\|`duration` (default `title`), `order` = `asc`\|`desc`, `offset` (0), `limit` (50, max 500) → `Page<MediaItem>` |
| GET | `/api/media/recent` | `limit` (20) → `MediaItem[]` newest `addedAt` first |
| GET | `/api/media/continue` | in-progress items for the user (position > 0, not completed), most recently updated first → `MediaItem[]` |
| GET | `/api/media/:id` | `MediaItem` |
| GET | `/api/folders` | query `libraryId` (required), `path` (default "") → `{ "path": string, "folders": { "name": string, "path": string }[], "items": MediaItem[] }` |
| GET | `/api/series` | `{ "name": string, "episodeCount": number, "seasons": number[], "thumbnailItemId": string|null }[]` |
| GET | `/api/series/:name/episodes` | `MediaItem[]` sorted by season, episode (`:name` URL-encoded) |
| GET | `/api/media/:id/stream` | Raw file with full HTTP Range support (206, `Accept-Ranges: bytes`, correct `Content-Type`). Works for video, audio, image. |
| GET | `/api/media/:id/transcode.m3u8` | HLS on-the-fly transcode (ffmpeg → h264/aac) for non-direct-playable video. Query `start` (seconds, optional). Segments at `/api/media/:id/hls/<session>/<segment>.ts`. Token must be propagated in segment URLs. |
| GET | `/api/media/:id/thumbnail` | JPEG; 404 if none. Query `w` optional width. |
| GET | `/api/media/:id/subtitles/:subId` | Always returns **WebVTT** (`text/vtt`), converting SRT on the fly. |
| GET | `/api/media/:id/progress` | progress object or `null` |
| PUT | `/api/media/:id/progress` | body `{ "positionSec": number, "completed"?: boolean }` → progress. Server auto-marks completed when position ≥ 95% of duration. |
| GET | `/api/users` | admin; list users |
| POST | `/api/users` | admin; `{ username, password, isAdmin }` |
| DELETE | `/api/users/:id` | admin |

Errors: JSON `{ "error": "message" }` with proper status codes. Non-admins get `403` from every admin endpoint.

## Client playback rule (all clients)

1. If `directPlayable` → play `/api/media/:id/stream?token=...`.
2. Else video → play `/api/media/:id/transcode.m3u8?token=...` (HLS).
   - Android ExoPlayer and iOS AVPlayer may try `stream` first for mkv etc. (ExoPlayer handles mkv natively) — Android: use `stream` for everything ExoPlayer supports (mp4, mkv, webm, ts, mp3, flac, …) and fall back to HLS on player error. iOS: use `stream` when `directPlayable`, else HLS.
3. Report progress every ~10s and on pause/stop via `PUT /progress`. Resume from `progress.positionSec` if present and not completed (ask "Resume / Start over").
4. Subtitles via `/subtitles/:subId` (WebVTT).

## Client UX (all apps)

- First launch: list servers found on the local network (see "LAN discovery") and let the user pick one, or enter server URL (e.g. `http://192.168.1.10:8096`), validate via `/api/server/info`, then login. Persist URL + token.
- Home: "Continue watching", "Recently added", then sections for Movies, TV Shows, Music, Photos.
- Browse by kind, by folder, search.
- Detail screen → Play.
- Video player with seek, subtitles, resume. Audio player with queue (play folder/album). Photo viewer with swipe.
- Branding: name "Home Centre", dark theme, accent colour `#E50914`-ish red is NOT used; use teal `#14B8A6` accent on near-black `#0B0F14` background.

## LAN discovery

Lets the apps find servers on the same network without typing an address.

### Server
- Listens for UDP datagrams on `0.0.0.0:DISCOVERY_PORT` (env, default **7359**; `0` disables).
- Request payload: the ASCII bytes `HOMECENTRE_DISCOVER` (ignore anything else, and never reply to more than ~20 packets/second in total).
- Reply (unicast UDP to the sender's address and port), UTF-8 JSON:
  `{ "product": "home-centre", "id": "<uuid>", "name": "Home Centre", "version": "1.0.0", "port": 8096, "url": null }`
  - `port` = `ADVERTISED_PORT` env (default = `PORT`), i.e. the HTTP port as reachable from the LAN (differs if Docker maps it).
  - `url` = `PUBLIC_URL` env if set (e.g. `http://192.168.1.10:8096`), else `null`.
- Env `SERVER_NAME` (default "Home Centre") is the display name in both the UDP reply and `/api/server/info`.
- docker-compose publishes `7359:7359/udp`. On Docker Desktop (Windows/macOS) LAN broadcasts do not reach containers, which is why clients also do the HTTP scan below; on Linux the UDP path works (or use `network_mode: host`).

### Clients (Android phone, Android TV, iPhone)
Run both methods at once, merge results, de-duplicate by `id`, show each server as soon as it is found, stop after ~6 s total. Show a "Search again" action.
1. **UDP broadcast** (Android/TV only — iOS needs a special Apple multicast entitlement, so iOS skips this): send `HOMECENTRE_DISCOVER` to `255.255.255.255:7359` and to the Wi-Fi/Ethernet subnet broadcast address, listen 2.5 s for replies. Server URL = `url` if non-null, else `http://<reply source IP>:<port>`.
2. **HTTP scan**: for every host address in the device's own IPv4 subnet (if the prefix is shorter than /24, scan only the /24 containing the device), `GET http://<ip>:8096/api/server/info` with ~800 ms connect+read timeout, at most 64 requests in flight; accept when `product == "home-centre"`. Skip the device's own address. Also probe the previously saved server URL if any.
- Found entries show `name`, URL, and are tappable / D-pad focusable; choosing one validates via `/api/server/info` and continues to login. Manual URL entry remains available.
- If nothing is found: show a short hint ("Make sure the phone and the server are on the same Wi-Fi network") and keep the manual entry field.
