package com.ellenjoe.homecentre.core.playback

import android.content.Context
import android.util.Log
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.model.MediaItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Owns an ExoPlayer for one video: stream first, HLS transcode fallback on error,
 * resume position and progress reporting. Create/use/release on the main thread.
 */
class VideoPlaybackController(
    context: Context,
    private val repository: HomeCentreRepository,
    private val item: MediaItem,
    scope: CoroutineScope,
) {
    val player: ExoPlayer = PlayerFactory.create(context, repository, forMusic = false)
    private val urls = repository.urls()
    private var source: PlaybackSource? = null
    private var fallback: PlaybackSource? = null
    private var triedFallback = false

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _sourceType = MutableStateFlow<SourceType?>(null)
    val sourceType: StateFlow<SourceType?> = _sourceType.asStateFlow()

    private val reporter = ProgressReporter(repository, player, scope, offsetSec = { source?.offsetSec ?: 0.0 })

    private val listener = object : Player.Listener {
        override fun onPlayerError(error: PlaybackException) {
            Log.w("HomeCentrePlayer", "Playback error on ${source?.type}: ${error.errorCodeName}", error)
            if (!triedFallback && source?.type == SourceType.STREAM) {
                triedFallback = true
                val pos = positionSec()
                load(PlaybackSelector.hlsAt(item, urls, pos), startMs = 0)
                return
            }
            _error.value = "Cannot play this file (${error.errorCodeName})"
        }
    }

    init {
        player.addListener(listener)
        reporter.attach()
    }

    /** Real position in the media in seconds (accounts for HLS start offset). */
    fun positionSec(): Double = (source?.offsetSec ?: 0.0) + player.currentPosition.coerceAtLeast(0) / 1000.0

    fun start(startSec: Double) {
        val plan = PlaybackSelector.plan(item, urls, startSec)
        fallback = plan.fallback
        triedFallback = plan.fallback == null
        val primary = plan.primary
        val startMs = if (primary.type == SourceType.STREAM) (startSec * 1000).toLong() else 0L
        load(primary, startMs)
    }

    private fun load(src: PlaybackSource, startMs: Long) {
        source = src
        _sourceType.value = src.type
        _error.value = null
        player.setMediaItem(PlayerFactory.videoItem(item, src, urls), startMs)
        player.prepare()
        player.playWhenReady = true
    }

    fun seekBySeconds(delta: Int) {
        val target = (player.currentPosition + delta * 1000L).coerceAtLeast(0)
        val dur = player.duration
        player.seekTo(if (dur > 0) target.coerceAtMost(dur) else target)
    }

    fun release() {
        reporter.release()
        player.removeListener(listener)
        player.release()
    }
}
