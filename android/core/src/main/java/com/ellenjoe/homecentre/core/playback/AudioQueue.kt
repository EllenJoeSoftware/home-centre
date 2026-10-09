package com.ellenjoe.homecentre.core.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.model.MediaItem
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Helpers for driving [PlaybackService] from UI code through a [MediaController]. */
object AudioQueue {

    suspend fun connect(context: Context): MediaController {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        return suspendCancellableCoroutine { cont ->
            future.addListener({
                try {
                    cont.resume(future.get())
                } catch (e: Exception) {
                    cont.resumeWithException(e)
                }
            }, ContextCompat.getMainExecutor(context))
            cont.invokeOnCancellation { MediaController.releaseFuture(future) }
        }
    }

    /** Replaces the queue with [queue] and starts playing at [start] (resuming its progress). */
    fun play(controller: MediaController, repository: HomeCentreRepository, queue: List<MediaItem>, start: MediaItem) {
        val items = PlayerFactory.audioItems(queue, repository.urls())
        val index = queue.indexOfFirst { it.id == start.id }.coerceAtLeast(0)
        val startMs = ((start.resumePositionSec ?: 0.0) * 1000).toLong()
        controller.setMediaItems(items, index, startMs)
        controller.prepare()
        controller.play()
    }
}
