# Home Centre — Android (phone + TV)

One Gradle project:

| Module | What |
|---|---|
| `:core` | API client (Retrofit/OkHttp/kotlinx.serialization), DataStore settings, repository, playback URL selection (stream → HLS fallback), progress reporter, Media3 player setup, background audio `PlaybackService`, Coil image loader |
| `:mobile` | Phone/tablet app `com.ellenjoe.homecentre` (Compose + Material 3) |
| `:tv` | Android TV app `com.ellenjoe.homecentre.tv` (Compose for TV, Leanback launcher) |

## Build

Requires JDK 17+ and an Android SDK (platform 35). Put `sdk.dir=...` in `local.properties` or set `ANDROID_HOME`.

```bash
./gradlew :core:testDebugUnitTest :mobile:assembleDebug :tv:assembleDebug
./gradlew :mobile:assembleRelease :tv:assembleRelease
```

## Release signing

Release builds read these environment variables:

| Env var | CI secret |
|---|---|
| `HC_KEYSTORE_FILE` (path; CI decodes it from base64) | `ANDROID_KEYSTORE_BASE64` |
| `HC_KEYSTORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD` |
| `HC_KEY_ALIAS` | `ANDROID_KEY_ALIAS` |
| `HC_KEY_PASSWORD` (defaults to the store password) | `ANDROID_KEY_PASSWORD` |

If no keystore is configured, **release APKs are signed with the debug keystore** so they can still be
side-loaded. On CI that debug keystore is regenerated on every run, so such APKs cannot be installed
as an *update* over a previous build (uninstall first). Configure the secrets for upgradeable releases.

Create a keystore with:

```bash
keytool -genkeypair -v -keystore release.jks -alias homecentre -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.jks   # → ANDROID_KEYSTORE_BASE64
```

`HC_VERSION_CODE` / `HC_VERSION_NAME` override the version (CI uses the run number and tag).

## Playback rules (see docs/API.md)

- Video: try `/api/media/:id/stream` for everything ExoPlayer can demux (mp4, mkv, webm, ts, avi, …);
  on a player error switch to `/transcode.m3u8?start=<pos>`. wmv/asf/rm/vob go straight to HLS.
- Audio/images: `/stream`. Subtitles: side-loaded WebVTT from `/subtitles/:subId`.
- Progress: `PUT /progress` every 10 s while playing and on pause/stop/item change.
