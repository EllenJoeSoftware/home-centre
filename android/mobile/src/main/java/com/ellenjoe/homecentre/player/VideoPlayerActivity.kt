package com.ellenjoe.homecentre.player

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import com.ellenjoe.homecentre.core.HomeCentre
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.playback.VideoPlaybackController
import com.ellenjoe.homecentre.ui.common.formatDuration
import com.ellenjoe.homecentre.ui.theme.HomeCentreTheme

/** Full-screen landscape video player (Media3 PlayerView hosted in Compose). */
class VideoPlayerActivity : ComponentActivity() {

    companion object {
        private const val EXTRA_ID = "id"
        fun intent(context: Context, id: String) =
            Intent(context, VideoPlayerActivity::class.java).putExtra(EXTRA_ID, id)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val id = intent.getStringExtra(EXTRA_ID).orEmpty()
        setContent {
            HomeCentreTheme {
                VideoPlayerScreen(id, onExit = { finish() })
            }
        }
    }
}

private sealed interface Stage {
    data object Loading : Stage
    data class AskResume(val item: MediaItem, val positionSec: Double) : Stage
    data class Playing(val item: MediaItem, val startSec: Double) : Stage
    data class Failed(val message: String) : Stage
}

@Composable
private fun VideoPlayerScreen(id: String, onExit: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val repo = remember { HomeCentre.repository(ctx) }
    var stage by remember { mutableStateOf<Stage>(Stage.Loading) }

    LaunchedEffect(id) {
        stage = try {
            repo.load()
            val item = repo.item(id)
            val resume = item.resumePositionSec
            if (resume != null) Stage.AskResume(item, resume) else Stage.Playing(item, 0.0)
        } catch (e: Exception) {
            Stage.Failed(e.userMessage())
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        when (val s = stage) {
            Stage.Loading -> CircularProgressIndicator()
            is Stage.Failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(s.message, color = MaterialTheme.colorScheme.error)
                Button(onClick = onExit, modifier = Modifier.padding(top = 12.dp)) { Text("Close") }
            }
            is Stage.AskResume -> AlertDialog(
                onDismissRequest = onExit,
                title = { Text(s.item.title) },
                text = { Text("Resume from ${formatDuration(s.positionSec)}?") },
                confirmButton = { Button(onClick = { stage = Stage.Playing(s.item, s.positionSec) }) { Text("Resume") } },
                dismissButton = { TextButton(onClick = { stage = Stage.Playing(s.item, 0.0) }) { Text("Start over") } },
            )
            is Stage.Playing -> PlayerHost(s.item, s.startSec, onExit)
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun PlayerHost(item: MediaItem, startSec: Double, onExit: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = remember { HomeCentre.repository(ctx) }
    val controller = remember(item.id) { VideoPlaybackController(ctx, repo, item, scope).also { it.start(startSec) } }
    val error by controller.error.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    DisposableEffect(controller) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) controller.player.pause()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            controller.release()
        }
    }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    player = controller.player
                    useController = true
                    setShowSubtitleButton(true)
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                    keepScreenOn = true
                    setFullscreenButtonClickListener { onExit() }
                }
            },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )
        error?.let {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(it, color = MaterialTheme.colorScheme.error)
                Button(onClick = onExit, modifier = Modifier.padding(top = 12.dp)) { Text("Close") }
            }
        }
    }
}
