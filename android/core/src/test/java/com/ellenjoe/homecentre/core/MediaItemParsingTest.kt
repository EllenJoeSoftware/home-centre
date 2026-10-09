package com.ellenjoe.homecentre.core

import com.ellenjoe.homecentre.core.api.ApiClient
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.model.ProgressUpdate
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MediaItemParsingTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().apply { start() } }
    @After fun tearDown() { server.shutdown() }

    private fun api(token: String? = "tok123") =
        ApiClient.create(server.url("/"), ApiClient.okHttpClient { token })

    private val episodeJson = """
        {
          "id": "0123456789abcdef",
          "kind": "video",
          "title": "Pilot",
          "fileName": "Show.S01E02.mkv",
          "relativePath": "TV/Show/Show.S01E02.mkv",
          "libraryId": "lib1",
          "folder": "TV/Show",
          "size": 734003200,
          "mimeType": "video/x-matroska",
          "durationSec": 2640.5,
          "width": 1920,
          "height": 1080,
          "videoCodec": "h264",
          "audioCodec": "ac3",
          "container": "matroska",
          "directPlayable": false,
          "series": { "name": "Show", "season": 1, "episode": 2 },
          "artist": null, "album": null, "year": null,
          "addedAt": "2026-01-02T03:04:05.000Z",
          "modifiedAt": "2026-01-01T00:00:00.000Z",
          "hasThumbnail": true,
          "subtitles": [ { "id": "s0", "language": "en", "label": "English", "format": "srt" } ],
          "progress": { "positionSec": 660, "completed": false, "updatedAt": "2026-01-03T00:00:00Z" },
          "someFutureField": 42
        }
    """.trimIndent()

    @Test fun parsesMediaItemAndSendsBearer() = runTest {
        server.enqueue(MockResponse().setBody(episodeJson).setHeader("Content-Type", "application/json"))
        val item = api().item("0123456789abcdef")

        val req = server.takeRequest()
        assertEquals("/api/media/0123456789abcdef", req.path)
        assertEquals("Bearer tok123", req.getHeader("Authorization"))

        assertEquals(MediaKind.VIDEO, item.kind)
        assertEquals("Show.S01E02.mkv", item.fileName)
        assertEquals(734003200L, item.size)
        assertEquals(2640.5, item.durationSec!!, 0.001)
        assertEquals(1, item.series!!.season)
        assertEquals(2, item.series!!.episode)
        assertNull(item.artist)
        assertFalse(item.directPlayable)
        assertEquals("mkv", item.extension)
        assertEquals("English", item.subtitles.single().label)
        assertEquals(660.0, item.resumePositionSec!!, 0.001)
        assertEquals(0.25f, item.progressFraction!!, 0.01f)
    }

    @Test fun parsesPageOfAudioWithNullables() = runTest {
        val body = """
            {"items":[{"id":"a","kind":"audio","title":"Song","fileName":"song.flac","relativePath":"song.flac",
            "libraryId":"l","folder":"","size":1,"mimeType":"audio/flac","durationSec":null,"width":null,"height":null,
            "videoCodec":null,"audioCodec":"flac","container":"flac","directPlayable":true,"series":null,
            "artist":"Band","album":"LP","year":1999,"addedAt":"x","modifiedAt":"y","hasThumbnail":false,
            "subtitles":[],"progress":null}],"total":1,"offset":0,"limit":50}
        """.trimIndent()
        server.enqueue(MockResponse().setBody(body))
        val page = api().media(kind = "audio", limit = 50)
        val req = server.takeRequest()
        assertTrue(req.path!!.startsWith("/api/media?"))
        assertTrue(req.path!!.contains("kind=audio"))
        assertEquals(1, page.total)
        val a = page.items.single()
        assertEquals(MediaKind.AUDIO, a.kind)
        assertEquals("Band", a.artist)
        assertEquals(1999, a.year)
        assertNull(a.progress)
        assertNull(a.progressFraction)
    }

    @Test fun progressPutBody() = runTest {
        server.enqueue(MockResponse().setBody("""{"positionSec":12.5,"completed":false,"updatedAt":"z"}"""))
        api().putProgress("abc", ProgressUpdate(12.5))
        val req = server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/media/abc/progress", req.path)
        assertEquals("""{"positionSec":12.5}""", req.body.readUtf8())
    }

    @Test fun noAuthHeaderWithoutToken() = runTest {
        server.enqueue(MockResponse().setBody("""{"name":"Home Centre","version":"1.0.0"}"""))
        val info = ApiClient.create(server.url("/"), OkHttpClient()).serverInfo()
        assertEquals("Home Centre", info.name)
        assertNull(server.takeRequest().getHeader("Authorization"))
    }
}
