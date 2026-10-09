package com.ellenjoe.homecentre.core.playback

import android.util.Log
import androidx.media3.common.Player
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Reports playback progress via `PUT /api/media/:id/progress` every ~10 s while playing,
 * and immediately on pause, item change, end and release.
 *
 * The media id is taken from `player.currentMediaItem.mediaId` (we always set it to the
 * Home Centre item id). [offsetSec] adds the HLS `start` offset to the player position.
 * Must be used from the main thread (Player access).
 */
class ProgressReporter(
    private val repository: HomeCentreRepository,
    private val player: Player,
    private val scope: CoroutineScope,
    private val offsetSec: () -> Double = { 0.0 },
    private val intervalMs: Long = 10_000,
) : Player.Listener {

    private var job: Job? = null
    private var lastId: String? = null
    private var lastPos: Double = 0.0
    private var lastReported: Pair<String, Long>? = null

    fun attach() {
        player.addListener(this)
        job = scope.launch {
            var ticks = 0L
            while (isActive) {
                delay(1_000)
                snapshot()
                ticks++
                if (player.isPlaying && ticks * 1_000 >= intervalMs) {
                    ticks = 0
                    reportNow()
                }
            }
        }
    }

    private fun snapshot() {
        val id = player.currentMediaItem?.mediaId?.takeIf { it.isNotEmpty() } ?: return
        lastId = id
        lastPos = offsetSec() + player.currentPosition.coerceAtLeast(0) / 1000.0
    }

    fun reportNow(completed: Boolean? = null) {
        snapshot()
        send(lastId ?: return, lastPos, completed)
    }

    private fun send(id: String, pos: Double, completed: Boolean?) {
        val key = id to pos.toLong()
        if (completed == null && key == lastReported) return
        lastReported = key
        repository.appScope.launch {
            runCatching { repository.putProgress(id, pos, completed) }
                .onFailure { Log.w("ProgressReporter", "progress report failed: ${it.message}") }
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (!isPlaying && player.playbackState != Player.STATE_ENDED) reportNow()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_ENDED) {
            lastId?.let { send(it, lastPos, true) }
        }
    }

    override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
        val prev = lastId
        if (prev != null && prev != mediaItem?.mediaId) {
            send(prev, lastPos, if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) true else null)
        }
        lastId = mediaItem?.mediaId
        lastPos = 0.0
    }

    fun release() {
        reportNow()
        job?.cancel()
        player.removeListener(this)
    }
}
