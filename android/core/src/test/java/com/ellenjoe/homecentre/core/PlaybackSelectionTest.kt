package com.ellenjoe.homecentre.core

import com.ellenjoe.homecentre.core.api.ApiClient
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.playback.PlaybackSelector
import com.ellenjoe.homecentre.core.playback.PlaybackUrls
import com.ellenjoe.homecentre.core.playback.SourceType
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackSelectionTest {
    private val urls = PlaybackUrls("http://192.168.1.10:8096/".toHttpUrl(), "a.b.c")

    private fun item(fileName: String, kind: MediaKind = MediaKind.VIDEO, direct: Boolean = false) = MediaItem(
        id = "id1", kind = kind, title = "t", fileName = fileName, relativePath = fileName,
        libraryId = "l", folder = "", size = 1, mimeType = "x", directPlayable = direct,
        addedAt = "", modifiedAt = "", hasThumbnail = false,
    )

    @Test fun directPlayableVideoUsesStreamWithHlsFallback() {
        val plan = PlaybackSelector.plan(item("movie.mp4", direct = true), urls)
        assertEquals(SourceType.STREAM, plan.primary.type)
        assertEquals("http://192.168.1.10:8096/api/media/id1/stream?token=a.b.c", plan.primary.url)
        assertNotNull(plan.fallback)
        assertEquals(SourceType.HLS, plan.fallback!!.type)
    }

    @Test fun mkvNotDirectPlayableStillTriesStreamFirst() {
        val plan = PlaybackSelector.plan(item("movie.mkv"), urls, startSec = 125.7)
        assertEquals(SourceType.STREAM, plan.primary.type)
        assertEquals(SourceType.HLS, plan.fallback!!.type)
        assertEquals("http://192.168.1.10:8096/api/media/id1/transcode.m3u8?token=a.b.c&start=125", plan.fallback!!.url)
        assertEquals(125.0, plan.fallback!!.offsetSec, 0.0)
    }

    @Test fun wmvGoesStraightToHls() {
        val plan = PlaybackSelector.plan(item("old.WMV"), urls)
        assertEquals(SourceType.HLS, plan.primary.type)
        assertEquals("http://192.168.1.10:8096/api/media/id1/transcode.m3u8?token=a.b.c", plan.primary.url)
        assertEquals(0.0, plan.primary.offsetSec, 0.0)
        assertNull(plan.fallback)
    }

    @Test fun audioAlwaysStreamsWithoutFallback() {
        val plan = PlaybackSelector.plan(item("song.wma", kind = MediaKind.AUDIO), urls)
        assertEquals(SourceType.STREAM, plan.primary.type)
        assertNull(plan.fallback)
    }

    @Test fun otherUrls() {
        assertEquals("http://192.168.1.10:8096/api/media/id1/thumbnail?token=a.b.c&w=300", urls.thumbnail("id1", 300))
        assertEquals("http://192.168.1.10:8096/api/media/id1/subtitles/s%201?token=a.b.c", urls.subtitle("id1", "s 1"))
        val noToken = PlaybackUrls("http://h:8096/".toHttpUrl(), null)
        assertEquals("http://h:8096/api/media/x/stream", noToken.stream("x"))
    }

    @Test fun normalizesServerUrls() {
        assertEquals("http://192.168.1.10:8096/", ApiClient.normalizeServerUrl("192.168.1.10:8096").toString())
        assertEquals("http://host:8096/", ApiClient.normalizeServerUrl(" http://host:8096/api/ ").toString())
        assertEquals("https://example.com/media/", ApiClient.normalizeServerUrl("https://example.com/media").toString())
        assertNull(ApiClient.normalizeServerUrl(""))
    }
}
