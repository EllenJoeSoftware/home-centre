package com.ellenjoe.homecentre.core.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.ellenjoe.homecentre.core.HomeCentre
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Background audio playback with a media notification (Media3 handles the notification
 * and foreground state automatically). Apps connect with a MediaController.
 */
class PlaybackService : MediaSessionService() {

    private var session: MediaSession? = null
    private var reporter: ProgressReporter? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        val repo = HomeCentre.repository(this)
        val player: ExoPlayer = PlayerFactory.create(this, repo, forMusic = true)
        val builder = MediaSession.Builder(this, player).setCallback(object : MediaSession.Callback {
            override fun onAddMediaItems(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo,
                mediaItems: MutableList<MediaItem>,
            ): ListenableFuture<MutableList<MediaItem>> {
                val resolved = mediaItems.map { item ->
                    val uri = item.requestMetadata.mediaUri ?: item.localConfiguration?.uri
                    if (uri == null) item else item.buildUpon().setUri(uri).build()
                }.toMutableList()
                return Futures.immediateFuture(resolved)
            }
        })
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            builder.setSessionActivity(
                PendingIntent.getActivity(
                    this, 0, launch,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
            )
        }
        session = builder.build()
        reporter = ProgressReporter(repo, player, scope).also { it.attach() }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        reporter?.release()
        reporter = null
        session?.run {
            player.release()
            release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }
}
