package com.ellenjoe.homecentre.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.playback.AudioQueue
import com.ellenjoe.homecentre.ui.Nav
import com.ellenjoe.homecentre.ui.common.Artwork
import com.ellenjoe.homecentre.ui.common.formatDuration
import com.ellenjoe.homecentre.ui.common.rememberRepository
import kotlinx.coroutines.delay

private data class NowPlaying(
    val title: String = "",
    val artist: String = "",
    val artwork: String? = null,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val index: Int = -1,
    val queue: List<Pair<String, String>> = emptyList(), // title, artist
)

private fun MediaController.snapshot(): NowPlaying {
    val md = mediaMetadata
    return NowPlaying(
        title = md.title?.toString().orEmpty(),
        artist = listOfNotNull(md.artist, md.albumTitle).joinToString(" · "),
        artwork = md.artworkUri?.toString(),
        isPlaying = isPlaying,
        positionMs = currentPosition.coerceAtLeast(0),
        durationMs = duration.takeIf { it > 0 } ?: 0,
        index = currentMediaItemIndex,
        queue = (0 until mediaItemCount).map { i ->
            val m = getMediaItemAt(i).mediaMetadata
            m.title?.toString().orEmpty() to m.artist?.toString().orEmpty()
        },
    )
}

@Composable
fun AudioPlayerScreen(startId: String?, nav: Nav) {
    val ctx = LocalContext.current
    val repo = rememberRepository()
    var controller by remember { mutableStateOf<MediaController?>(null) }
    var state by remember { mutableStateOf(NowPlaying()) }
    var error by remember { mutableStateOf<String?>(null) }
    var started by rememberSaveable(startId) { mutableStateOf(false) }

    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // Connect to the background PlaybackService.
    LaunchedEffect(Unit) {
        try {
            controller = AudioQueue.connect(ctx)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.userMessage()
        }
    }
    DisposableEffect(controller) {
        val c = controller
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                c?.let { state = it.snapshot() }
            }
        }
        c?.addListener(listener)
        c?.let { state = it.snapshot() }
        onDispose {
            c?.removeListener(listener)
            c?.release()
        }
    }

    // Start the requested track with its folder as the queue.
    LaunchedEffect(controller, startId) {
        val c = controller ?: return@LaunchedEffect
        if (startId == null || started) return@LaunchedEffect
        try {
            val item = repo.item(startId)
            val queue = repo.siblings(item, MediaKind.AUDIO)
            AudioQueue.play(c, repo, queue, item)
            started = true
        } catch (e: Exception) {
            error = e.userMessage()
        }
    }

    // Position ticker.
    LaunchedEffect(controller) {
        val c = controller ?: return@LaunchedEffect
        while (true) {
            state = state.copy(positionMs = c.currentPosition.coerceAtLeast(0), durationMs = c.duration.takeIf { it > 0 } ?: 0)
            delay(500)
        }
    }

    Scaffold(topBar = { SimpleTopBar("Now playing", nav::back) }) { padding ->
        val c = controller
        when {
            error != null -> Box(Modifier.padding(padding)) { com.ellenjoe.homecentre.ui.common.ErrorBox(error!!) }
            c == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.queue.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Nothing playing. Pick a song from Music.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> Column(
                Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Artwork(
                    state.artwork, MediaKind.AUDIO,
                    Modifier.padding(top = 8.dp).widthIn(max = 320.dp).fillMaxWidth(0.8f).aspectRatio(1f).clip(RoundedCornerShape(16.dp)),
                )
                Text(state.title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 16.dp))
                Text(state.artist, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                var dragging by remember { mutableStateOf(false) }
                var dragValue by remember { mutableFloatStateOf(0f) }
                val dur = state.durationMs.coerceAtLeast(1)
                Slider(
                    value = if (dragging) dragValue else (state.positionMs.toFloat() / dur).coerceIn(0f, 1f),
                    onValueChange = { dragging = true; dragValue = it },
                    onValueChangeFinished = { c.seekTo((dragValue * dur).toLong()); dragging = false },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(formatDuration(state.positionMs / 1000.0).ifEmpty { "0:00" }, style = MaterialTheme.typography.bodySmall)
                    Text(formatDuration(state.durationMs / 1000.0), style = MaterialTheme.typography.bodySmall)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    IconButton(onClick = { c.seekToPreviousMediaItem() }) { Icon(Icons.Filled.SkipPrevious, "Previous", Modifier.size(36.dp)) }
                    FilledIconButton(onClick = { if (c.isPlaying) c.pause() else c.play() }, modifier = Modifier.size(64.dp)) {
                        Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, "Play/Pause", Modifier.size(36.dp))
                    }
                    IconButton(onClick = { c.seekToNextMediaItem() }) { Icon(Icons.Filled.SkipNext, "Next", Modifier.size(36.dp)) }
                }
                Text("Queue", style = MaterialTheme.typography.titleSmall, modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp))
                LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
                    items(state.queue.indices.toList()) { i ->
                        val (t, a) = state.queue[i]
                        Column(
                            Modifier.fillMaxWidth().clickable { c.seekTo(i, 0); c.play() }.padding(vertical = 8.dp)
                        ) {
                            Text(t, color = if (i == state.index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (a.isNotEmpty()) Text(a, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}
