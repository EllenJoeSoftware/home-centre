package com.ellenjoe.homecentre.core.playback

import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import okhttp3.HttpUrl

/** Builds authenticated URLs for streaming / image endpoints (token passed as `?token=`). */
class PlaybackUrls(private val baseUrl: HttpUrl, private val token: String?) {

    private fun builder(vararg segments: String): HttpUrl.Builder {
        val b = baseUrl.newBuilder().addPathSegment("api").addPathSegment("media")
        segments.forEach { b.addPathSegment(it) }
        if (!token.isNullOrBlank()) b.addQueryParameter("token", token)
        return b
    }

    fun stream(id: String): String = builder(id, "stream").build().toString()

    fun hls(id: String, startSec: Double? = null): String {
        val b = builder(id, "transcode.m3u8")
        if (startSec != null && startSec > 0) b.addQueryParameter("start", startSec.toLong().toString())
        return b.build().toString()
    }

    fun thumbnail(id: String, width: Int? = null): String {
        val b = builder(id, "thumbnail")
        if (width != null) b.addQueryParameter("w", width.toString())
        return b.build().toString()
    }

    fun subtitle(id: String, subId: String): String = builder(id, "subtitles", subId).build().toString()
}

enum class SourceType { STREAM, HLS }

/**
 * A concrete source to hand to the player. For HLS started with `?start=`, the player's timeline
 * begins at [offsetSec] of the real media, so real position = offsetSec + player position.
 */
data class PlaybackSource(
    val type: SourceType,
    val url: String,
    val offsetSec: Double = 0.0,
)

data class PlaybackPlan(
    val primary: PlaybackSource,
    /** Used when the primary source fails with a player error (null = no fallback). */
    val fallback: PlaybackSource?,
)

/**
 * Implements the Android client playback rule from docs/API.md:
 * use the raw `stream` for everything ExoPlayer can demux and fall back to HLS transcode on error.
 */
object PlaybackSelector {
    /** Containers ExoPlayer has no extractor for — go straight to HLS. */
    val EXOPLAYER_UNSUPPORTED_EXTENSIONS = setOf("wmv", "asf", "rm", "rmvb", "vob", "divx")

    fun plan(item: MediaItem, urls: PlaybackUrls, startSec: Double = 0.0): PlaybackPlan {
        if (item.kind != MediaKind.VIDEO) {
            return PlaybackPlan(PlaybackSource(SourceType.STREAM, urls.stream(item.id)), null)
        }
        val hlsStart = startSec.takeIf { it > 0 }?.let { it.toLong().toDouble() } ?: 0.0
        val hls = PlaybackSource(SourceType.HLS, urls.hls(item.id, hlsStart), hlsStart)
        val exoCanDemux = item.directPlayable || item.extension !in EXOPLAYER_UNSUPPORTED_EXTENSIONS
        return if (exoCanDemux) {
            PlaybackPlan(PlaybackSource(SourceType.STREAM, urls.stream(item.id)), hls)
        } else {
            PlaybackPlan(hls, null)
        }
    }

    /** Fallback HLS source starting at the current real position (used after a stream error). */
    fun hlsAt(item: MediaItem, urls: PlaybackUrls, positionSec: Double): PlaybackSource {
        val start = positionSec.coerceAtLeast(0.0).toLong().toDouble()
        return PlaybackSource(SourceType.HLS, urls.hls(item.id, start), start)
    }
}
