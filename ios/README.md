# Home Centre for iPhone

SwiftUI client for the Home Centre media server (see `../docs/API.md`).
iOS 16+, Swift 5 language mode (Xcode 15/16), no third-party dependencies.

## Build locally (macOS)

```bash
brew install xcodegen
cd ios
xcodegen generate          # creates HomeCentre.xcodeproj (git-ignored)
open HomeCentre.xcodeproj
```

To run on a device, set your team in Signing & Capabilities (or `DEVELOPMENT_TEAM` in `project.yml`).

Run the tests from the command line:

```bash
xcodebuild test -project HomeCentre.xcodeproj -scheme HomeCentre \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Layout

```
project.yml                XcodeGen spec (targets HomeCentre + HomeCentreTests, Info.plist keys)
HomeCentre/
  App/                     HomeCentreApp (entry, tabs), AppState (server/session state)
  API/                     Models (mirror the contract), APIClient (actor), MediaURLBuilder
                           (URLs + playback rule), Keychain token / UserDefaults server URL
  Features/
    ServerSetup, Login     first-run flow (validates via /api/server/info)
    Home                   Continue watching, Recently added, Movies, TV Shows, Music, Photos rows
    Browse                 paged grids per kind + Library tab
    Series                 TV shows → episodes by season
    Folders                libraries → folder tree (with "Play all" for audio)
    Search                 .searchable with kind scopes
    Detail                 metadata, Play / Resume, mark watched
    VideoPlayer            AVPlayerViewController wrapper, resume prompt, progress reporting,
                           VTT parser + custom subtitle overlay
    AudioPlayer            queue player, background audio, lock screen / remote commands, mini-player
    PhotoViewer            paging TabView + AsyncImage with zoom
    Settings               server info, scan, sign out
  Components/              theme, cards, navigation routes, presenter
  Resources/Assets.xcassets AppIcon (1024 universal), AccentColor #14B8A6, LaunchBackground #0B0F14
HomeCentreTests/           model decoding, VTT parser, playback URL selection
```

## Playback

- `directPlayable` items → `/api/media/:id/stream?token=…` (AVPlayer, resume by seeking).
- Other video → `/api/media/:id/transcode.m3u8?token=…` (HLS). Resuming passes `start=<sec>`; the
  player timeline then begins at 0, so the app adds that offset when reporting progress and timing subtitles.
- Progress is `PUT` every 10 s while playing, on pause, on close, and with `completed: true` at the end.
- Subtitles: AVPlayer can't side-load WebVTT into progressive files, so the app downloads
  `/subtitles/:subId`, parses cues, and renders the active cue in `AVPlayerViewController.contentOverlayView`
  from a periodic time observer.

## CI / IPA

`.github/workflows/ios.yml` (macOS 15 runner): generates the project, runs the unit tests on an
available iPhone simulator, archives an **unsigned** Release build and packages
`HomeCentre-unsigned.ipa` (uploaded as a workflow artifact, and attached to the GitHub Release for `v*` tags).

### Installing the unsigned IPA

An unsigned IPA cannot be installed directly. Sideload it with
[AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io), which re-sign it with your
Apple ID (free accounts: the app expires after 7 days and must be refreshed).

### TestFlight / App Store

`.github/workflows/ios-testflight.yml` builds a signed App Store build and uploads it to App Store
Connect. It works the same way as Remote for Mi Box: automatic, cloud-managed signing with the
App Store Connect API key, so there are no certificates or provisioning profiles to look after.

- Team: EllenJoe Software (`68ML476677`). Bundle ID: `com.ellenjoesoftware.homecentre`
- Runs on `macos-26` (Xcode 26, which App Store uploads require)
- Trigger: **Actions → iOS → TestFlight → Run workflow**, or push a `v*` tag.
- Build number = workflow run number. Version = the tag (`v1.2.0` → `1.2.0`), or `MARKETING_VERSION` in `project.yml` for manual runs.

One-time setup:

1. Add these 4 secrets to the GitHub repo. The values are the same as in `EllenJoeSoftware/MiRemote`.
   You can also make them organisation secrets so both repos share them.
   `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the full text of the `.p8` file).
2. In App Store Connect, go to **Apps → + → New App**: iOS, name *Home Centre* (or another name if
   that one is taken), bundle ID `com.ellenjoesoftware.homecentre`, SKU e.g. `homecentre`. The first
   archive registers the bundle ID automatically, so if it isn't in the dropdown yet, run the
   workflow once and then create the app.
3. Run the workflow. The build shows up in TestFlight after Apple finishes processing it.

## Notes

- `NSAllowsArbitraryLoads` + `NSAllowsLocalNetworking` are enabled because home servers are usually
  plain `http://` on the LAN. iOS shows a Local Network permission prompt on first connection.
- Background audio (`UIBackgroundModes: audio`) keeps music playing when locked and enables Picture in Picture.
