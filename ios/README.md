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

### Signed IPA / TestFlight (optional, later)

1. In the Apple Developer portal create the App ID `com.ellenjoe.homecentre`, an *Apple Distribution*
   certificate and an *App Store* (or *Ad Hoc*) provisioning profile named e.g. `HomeCentre Distribution`.
2. Add repository secrets: `IOS_CERT_P12_BASE64` (`base64 -i cert.p12`), `IOS_CERT_PASSWORD`,
   `IOS_PROVISION_PROFILE_BASE64`, `IOS_TEAM_ID`, and for TestFlight an App Store Connect API key:
   `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_BASE64`.
3. Add `ios/ExportOptions.plist`, for example:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>method</key><string>app-store-connect</string>  <!-- or release-testing (ad hoc) -->
     <key>signingStyle</key><string>manual</string>
     <key>teamID</key><string>YOURTEAMID</string>
     <key>provisioningProfiles</key><dict>
       <key>com.ellenjoe.homecentre</key><string>HomeCentre Distribution</string>
     </dict>
   </dict></plist>
   ```
4. Uncomment the signing steps at the bottom of `.github/workflows/ios.yml`.

## Notes

- `NSAllowsArbitraryLoads` + `NSAllowsLocalNetworking` are enabled because home servers are usually
  plain `http://` on the LAN. iOS shows a Local Network permission prompt on first connection.
- Background audio (`UIBackgroundModes: audio`) keeps music playing when locked and enables Picture in Picture.
