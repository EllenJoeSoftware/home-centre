package com.ellenjoe.homecentre.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.ui.Nav
import com.ellenjoe.homecentre.ui.Routes
import com.ellenjoe.homecentre.ui.common.Artwork
import com.ellenjoe.homecentre.ui.common.LoadContent
import com.ellenjoe.homecentre.ui.common.formatDuration
import com.ellenjoe.homecentre.ui.common.imageUrlFor
import com.ellenjoe.homecentre.ui.common.rememberLoad
import com.ellenjoe.homecentre.ui.common.rememberRepository
import com.ellenjoe.homecentre.ui.common.subtitleLine
import java.util.Locale

fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var v = bytes / 1024.0
    var i = 0
    while (v >= 1024 && i < units.lastIndex) { v /= 1024; i++ }
    return String.format(Locale.US, "%.1f %s", v, units[i])
}

fun MediaItem.technicalLines(): List<Pair<String, String>> = buildList {
    if (width != null && height != null) add("Resolution" to "${width}×${height}")
    videoCodec?.let { add("Video" to it) }
    audioCodec?.let { add("Audio" to it) }
    container?.let { add("Container" to it) }
    album?.let { add("Album" to it) }
    add("Size" to formatSize(this@technicalLines.size))
    add("File" to relativePath)
    if (subtitles.isNotEmpty()) add("Subtitles" to subtitles.joinToString { it.label })
}

@Composable
fun DetailScreen(id: String, nav: Nav) {
    val repo = rememberRepository()
    var refresh by remember { mutableIntStateOf(0) }
    // Reload when returning from the player so progress is up to date.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        var first = true
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (!first) refresh++
            first = false
        }
    }
    val (state, retry) = rememberLoad(id, refresh) { repo.item(id) }
    Scaffold(topBar = { SimpleTopBar("", nav::back) }) { padding ->
        Box(Modifier.padding(padding)) {
            LoadContent(state, retry) { item ->
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    val ratio = if (item.kind == MediaKind.VIDEO) 16f / 9f else 1f
                    Artwork(
                        imageUrlFor(repo, item, 1280), item.kind,
                        Modifier.fillMaxWidth().widthIn(max = 640.dp).aspectRatio(ratio),
                    )
                    Text(item.title, style = MaterialTheme.typography.headlineSmall)
                    item.series?.let { Text(it.name, color = MaterialTheme.colorScheme.primary) }
                    val sub = item.subtitleLine()
                    if (sub.isNotEmpty()) Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    item.progressFraction?.takeIf { it > 0 && item.progress?.completed != true }?.let { f ->
                        LinearProgressIndicator(progress = { f }, modifier = Modifier.fillMaxWidth())
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val resume = item.resumePositionSec
                        Button(onClick = { nav.play(item) }) {
                            Icon(Icons.Filled.PlayArrow, null)
                            Spacer(Modifier.size(6.dp))
                            Text(if (resume != null && item.kind == MediaKind.VIDEO) "Resume ${formatDuration(resume)}" else "Play")
                        }
                        if (item.series != null) {
                            OutlinedButton(onClick = { nav.go(Routes.episodes(item.series!!.name)) }) {
                                Icon(Icons.AutoMirrored.Filled.List, null)
                                Spacer(Modifier.size(6.dp))
                                Text("Episodes")
                            }
                        }
                        if (item.progress?.completed == true) {
                            Icon(Icons.Filled.Replay, "Watched", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    item.technicalLines().forEach { (k, v) ->
                        Row {
                            Text(k, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.widthIn(min = 96.dp))
                            Text(v)
                        }
                    }
                }
            }
        }
    }
}
