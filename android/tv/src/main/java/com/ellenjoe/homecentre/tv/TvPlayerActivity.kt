package com.ellenjoe.homecentre.tv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.view.Gravity
import androidx.activity.ComponentActivity
import androidx.annotation.OptIn
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.ellenjoe.homecentre.core.HomeCentre
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.playback.PlayerFactory
import com.ellenjoe.homecentre.core.playback.ProgressReporter
import com.ellenjoe.homecentre.core.playback.VideoPlaybackController
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Full-screen player for TV. Video uses [VideoPlaybackController] (stream → HLS fallback),
 * audio plays the item's folder as a queue. D-pad left/right seeks ±10 s while controls are
 * hidden; BACK always exits.
 */
@OptIn(UnstableApi::class)
class TvPlayerActivity : ComponentActivity() {

    companion object {
        private const val EXTRA_ID = "id"
        private const val EXTRA_START = "start"
        fun intent(context: Context, id: String, startSec: Double) =
            Intent(context, TvPlayerActivity::class.java).putExtra(EXTRA_ID, id).putExtra(EXTRA_START, startSec)
    }

    private lateinit var playerView: PlayerView
    private lateinit var message: TextView
    private var video: VideoPlaybackController? = null
    private var audioPlayer: ExoPlayer? = null
    private var audioReporter: ProgressReporter? = null

    private val player: Player? get() = video?.player ?: audioPlayer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        playerView = PlayerView(this).apply {
            useController = true
            setShowSubtitleButton(true)
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            controllerShowTimeoutMs = 4000
        }
        message = TextView(this).apply {
            setTextColor(0xFFF87171.toInt())
            textSize = 20f
            gravity = Gravity.CENTER
        }
        setContentView(FrameLayout(this).apply {
            addView(playerView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(message, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        })

        val id = intent.getStringExtra(EXTRA_ID).orEmpty()
        val start = intent.getDoubleExtra(EXTRA_START, 0.0)
        val repo = HomeCentre.repository(this)
        lifecycleScope.launch {
            try {
                repo.load()
                val item = repo.item(id)
                if (item.kind == MediaKind.AUDIO) {
                    val queue = repo.siblings(item, MediaKind.AUDIO)
                    val p = PlayerFactory.create(this@TvPlayerActivity, repo, forMusic = true)
                    audioPlayer = p
                    audioReporter = ProgressReporter(repo, p, lifecycleScope).also { it.attach() }
                    playerView.player = p
                    val items = PlayerFactory.audioItems(queue, repo.urls())
                    p.setMediaItems(items, queue.indexOfFirst { it.id == item.id }.coerceAtLeast(0), (start * 1000).toLong())
                    p.prepare()
                    p.play()
                } else {
                    val c = VideoPlaybackController(this@TvPlayerActivity, repo, item, lifecycleScope)
                    video = c
                    playerView.player = c.player
                    c.start(start)
                    launch { c.error.collectLatest { message.text = it.orEmpty() } }
                }
                playerView.requestFocus()
            } catch (e: Exception) {
                message.text = e.userMessage()
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) finish()
            return true
        }
        val p = player
        if (p != null && event.action == KeyEvent.ACTION_DOWN && !playerView.isControllerFullyVisible) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(p, -10); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(p, 10); return true }
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { if (p.isPlaying) p.pause() else p.play(); playerView.showController(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun seekBy(p: Player, seconds: Int) {
        val v = video
        if (v != null) v.seekBySeconds(seconds) else {
            val target = (p.currentPosition + seconds * 1000L).coerceAtLeast(0)
            p.seekTo(if (p.duration > 0) target.coerceAtMost(p.duration) else target)
        }
        playerView.showController()
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        playerView.player = null
        video?.release()
        video = null
        audioReporter?.release()
        audioPlayer?.release()
        audioPlayer = null
        super.onDestroy()
    }
}
