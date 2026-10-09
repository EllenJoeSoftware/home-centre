# Home Centre

Self-hosted media centre for streaming your own movies, TV shows, music and photos across your home network.

| Component | Folder | Tech | Delivered as |
|---|---|---|---|
| Media server | `server/` | Node 22, TypeScript, Fastify, SQLite, ffmpeg | Docker image `ghcr.io/<owner>/home-centre-server` |
| Web interface | `web/` | React 18, Vite, hls.js, nginx | Docker image `ghcr.io/<owner>/home-centre-web` |
| Android phone app | `android/mobile` | Kotlin, Jetpack Compose, Media3 ExoPlayer | `home-centre-mobile.apk` |
| Android TV box app | `android/tv` | Kotlin, Compose for TV, Media3 | `home-centre-tv.apk` |
| iPhone app | `ios/` | SwiftUI, AVKit (XcodeGen project) | `HomeCentre-unsigned.ipa` |

The API contract shared by every client is in [`docs/API.md`](docs/API.md).

## Quick start (server + web)

```bash
cp .env.example .env        # set MEDIA_PATH, BROWSE_PATH and ADMIN_PASSWORD
docker compose up -d        # pulls images from GHCR (add --build to build locally)
```

- Web interface: `http://<server-ip>:8080`
- Apps connect to: `http://<server-ip>:8096`
- Log in with `ADMIN_USER` / `ADMIN_PASSWORD`. Change the default password before exposing anything.

The server scans its media folders (initially just `/media`) at startup and then every `SCAN_INTERVAL_MINUTES` minutes. Admins can also start a rescan from **Settings** in the web UI. Suggested folder layout:

```
media/
  Movies/Some Movie (2019).mp4
  TV/Show Name/Season 1/Show Name S01E01.mkv   (+ Show Name S01E01.en.srt)
  Music/Artist/Album/01 Track.mp3
  Photos/2025/IMG_0001.jpg
```

### Managing media folders

The folders that get scanned (libraries) are stored in the server database and managed from **Settings → Media folders** in the web UI (admins only):

- **Add folder** opens a folder picker. Pick a location, click into folders (the green badge shows how many media files sit directly in each one), then **Add this folder**. Indexing starts straight away.
- **Change folder** points an existing library at another folder. Items from the old folder, including watch progress, are dropped and the new folder is scanned.
- **Rename** changes the display name. **Remove** asks for confirmation inline, then forgets the library and its items. Files on disk are never touched.

The picker can only see the server's `BROWSE_ROOTS`. In Docker these are `/media` (your `MEDIA_PATH`) and `/host`, which is the read-only mount of `BROWSE_PATH` from `.env`. Point `BROWSE_PATH` at a whole drive (`D:/`) or your user folder (`C:/Users/Wycliffe`) to pick any folder under it. Changing `BROWSE_PATH` requires `docker compose up -d` to recreate the container. A library cannot sit inside another one or contain one.

`MEDIA_DIRS` only seeds the list on the very first start. After that, the list in Settings is what counts.

Files the device can play natively are streamed directly with HTTP range support. Anything else, such as AVI or MKV with AC3 audio, is transcoded on the fly to HLS (H.264/AAC) by ffmpeg in the server container. SRT/VTT subtitles placed next to a video are picked up automatically.

## Apps

- **Android phone / Android TV box:** install the APKs from the GitHub Actions run artifacts or from a GitHub Release. On a TV box, sideload with a USB stick or "Send Files to TV", or use `adb install home-centre-tv.apk`. See [`android/README.md`](android/README.md).
- **iPhone:** install through TestFlight. The `iOS → TestFlight` workflow uploads signed builds to App Store Connect. An unsigned IPA for sideloading is also built. See [`ios/README.md`](ios/README.md).

On first launch the apps list the Home Centre servers they find on your network; pick one and log in. You can still type the address (e.g. `http://192.168.1.10:8096`) by hand.

### Finding the server

The apps scan the Wi-Fi network automatically, using a UDP broadcast on port **7359** (Android phone and TV) plus an HTTP check of port **8096** on every address in the local subnet (all apps). The phone or TV box must be on the same network as the server.

- `SERVER_NAME` in `.env` sets the name shown in the list.
- On Docker Desktop (Windows/macOS) broadcasts do not reach the container, so the HTTP scan does the work. Set `PUBLIC_URL=http://<this-PC-ip>:8096` in `.env` so the advertised address is right.
- On Windows, allow both ports through Windows Firewall (run PowerShell as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Home Centre HTTP" -Direction Inbound -Protocol TCP -LocalPort 8096 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Home Centre Discovery" -Direction Inbound -Protocol UDP -LocalPort 7359 -Action Allow -Profile Private
```

  Your Wi-Fi network must be set to **Private** in Windows network settings (or add `,Public` to `-Profile`).
- Set `DISCOVERY_PORT=0` on the server to turn UDP discovery off.

## GitHub Actions

| Workflow | Triggers | Output |
|---|---|---|
| `server.yml` | changes in `server/**`, `v*` tags | tests → multi-arch (amd64/arm64) image pushed to GHCR on `main` and tags |
| `web.yml` | changes in `web/**`, `v*` tags | typecheck/tests/build → multi-arch image pushed to GHCR |
| `android.yml` | changes in `android/**`, `v*` tags | unit tests → mobile + TV APK artifacts; GitHub Release on tags |
| `ios.yml` | changes in `ios/**`, `v*` tags | simulator tests → unsigned IPA artifact; GitHub Release on tags |
| `ios-testflight.yml` | manual run, `v*` tags | signed App Store build uploaded to TestFlight (see `ios/README.md`) |

**First push:** every workflow runs on its first push to `main`. To publish a release with all apps attached, push a tag such as `git tag v1.0.0 && git push origin v1.0.0`.

**Optional secrets**

- Android release signing: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them, APKs are signed with a throwaway debug key, so each new release has to be uninstalled before the next one can be installed.
- iOS TestFlight: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`. These are the same values as MiRemote; see `ios/README.md`.

GHCR packages are private by default. To pull them without logging in, make them public under the org's **Packages** settings, or run `docker login ghcr.io` first.

## Local development

```bash
# server (needs ffmpeg on PATH)
cd server && npm ci && MEDIA_DIRS=/path/to/media BROWSE_ROOTS=/path/to DATA_DIR=./.data ADMIN_PASSWORD=dev npm run dev
# web (proxies /api to localhost:8096)
cd web && npm ci && npm run dev
# android (JDK 17 + Android SDK)
cd android && ./gradlew :mobile:assembleDebug :tv:assembleDebug
# ios (macOS + Xcode 16)
cd ios && brew install xcodegen && xcodegen generate && open HomeCentre.xcodeproj
```
