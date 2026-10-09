package com.ellenjoe.homecentre.core.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import androidx.media3.common.MediaItem as ExoMediaItem

/** Shared ExoPlayer construction for video (activity-scoped) and audio (service-scoped) playback. */
@OptIn(UnstableApi::class)
object PlayerFactory {

    fun create(context: Context, repository: HomeCentreRepository, forMusic: Boolean): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("HomeCentre-Android")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
        repository.session.value.token?.let {
            http.setDefaultRequestProperties(mapOf("Authorization" to "Bearer $it"))
        }
        val dataSource = DefaultDataSource.Factory(context, http)
        val attrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(if (forMusic) C.AUDIO_CONTENT_TYPE_MUSIC else C.AUDIO_CONTENT_TYPE_MOVIE)
            .build()
        return ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(attrs, true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
    }

    /** Builds a Media3 item for [source], side-loading all WebVTT subtitles of [item]. */
    fun videoItem(item: MediaItem, source: PlaybackSource, urls: PlaybackUrls): ExoMediaItem {
        val subs = item.subtitles.map { sub ->
            ExoMediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(urls.subtitle(item.id, sub.id)))
                .setId(sub.id)
                .setMimeType(MimeTypes.TEXT_VTT)
                .setLanguage(sub.language)
                .setLabel(sub.label)
                .build()
        }
        val builder = ExoMediaItem.Builder()
            .setMediaId(item.id)
            .setUri(source.url)
            .setSubtitleConfigurations(subs)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(item.title)
                    .setArtworkUri(if (item.hasThumbnail) android.net.Uri.parse(urls.thumbnail(item.id)) else null)
                    .build()
            )
        if (source.type == SourceType.HLS) builder.setMimeType(MimeTypes.APPLICATION_M3U8)
        return builder.build()
    }

    /**
     * Audio queue items. The stream URI is also stored in requestMetadata so that
     * [PlaybackService] can restore it (MediaController strips local configuration).
     */
    fun audioItems(items: List<MediaItem>, urls: PlaybackUrls): List<ExoMediaItem> =
        items.filter { it.kind == MediaKind.AUDIO }.map { item ->
            val uri = android.net.Uri.parse(urls.stream(item.id))
            ExoMediaItem.Builder()
                .setMediaId(item.id)
                .setUri(uri)
                .setRequestMetadata(ExoMediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(item.title)
                        .setArtist(item.artist)
                        .setAlbumTitle(item.album)
                        .setArtworkUri(if (item.hasThumbnail) android.net.Uri.parse(urls.thumbnail(item.id, 512)) else null)
                        .setIsPlayable(true)
                        .setIsBrowsable(false)
                        .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                        .build()
                )
                .build()
        }
}
