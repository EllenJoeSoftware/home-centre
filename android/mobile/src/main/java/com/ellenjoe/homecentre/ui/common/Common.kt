package com.ellenjoe.homecentre.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ellenjoe.homecentre.core.HomeCentre
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind

@Composable
fun rememberRepository(): HomeCentreRepository {
    val ctx = LocalContext.current
    return remember { HomeCentre.repository(ctx) }
}

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ok<T>(val value: T) : Load<T>
    data class Err(val message: String) : Load<Nothing>
}

/** Loads [block] once per [key]; returns state plus a retry lambda. */
@Composable
fun <T> rememberLoad(vararg key: Any?, block: suspend () -> T): Pair<Load<T>, () -> Unit> {
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember(*key) { mutableStateOf<Load<T>>(Load.Loading) }
    LaunchedEffect(*key, attempt) {
        state = Load.Loading
        state = try {
            Load.Ok(block())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Load.Err(e.userMessage())
        }
    }
    return state to { attempt++ }
}

@Composable
fun <T> LoadContent(state: Load<T>, onRetry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        is Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is Load.Err -> ErrorBox(state.message, onRetry)
        is Load.Ok -> content(state.value)
    }
}

@Composable
fun ErrorBox(message: String, onRetry: (() -> Unit)? = null) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = MaterialTheme.colorScheme.error)
        if (onRetry != null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = onRetry) { Text("Retry") }
        }
    }
}

fun imageUrlFor(repo: HomeCentreRepository, item: MediaItem, width: Int = 400): String? = runCatching {
    val urls = repo.urls()
    when {
        item.hasThumbnail -> urls.thumbnail(item.id, width)
        item.kind == MediaKind.IMAGE -> urls.stream(item.id)
        else -> null
    }
}.getOrNull()

fun formatDuration(sec: Double?): String {
    if (sec == null || sec <= 0) return ""
    val s = sec.toLong()
    val h = s / 3600
    val m = (s % 3600) / 60
    val ss = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, ss) else "%d:%02d".format(m, ss)
}

fun MediaItem.subtitleLine(): String = buildList {
    series?.let { add("S%02dE%02d".format(it.season, it.episode)) }
    artist?.let { add(it) }
    year?.let { add(it.toString()) }
    formatDuration(durationSec).takeIf { it.isNotEmpty() }?.let { add(it) }
}.joinToString(" · ")

@Composable
fun Artwork(url: String?, kind: MediaKind, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        Icon(
            when (kind) {
                MediaKind.VIDEO -> Icons.Filled.Movie
                MediaKind.AUDIO -> Icons.Filled.MusicNote
                MediaKind.IMAGE -> Icons.Filled.Image
            },
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(36.dp),
        )
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = contentScale, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Card used in rows and grids. Video = 16:9, audio/photo = square. */
@Composable
fun MediaCard(item: MediaItem, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp? = 180.dp) {
    val repo = rememberRepository()
    val ratio = if (item.kind == MediaKind.VIDEO) 16f / 9f else 1f
    Column(
        (if (width != null) modifier.width(width) else modifier.fillMaxWidth())
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
    ) {
        Box {
            Artwork(
                imageUrlFor(repo, item),
                item.kind,
                Modifier.fillMaxWidth().aspectRatio(ratio).clip(RoundedCornerShape(10.dp)),
            )
            item.progressFraction?.takeIf { it > 0f && item.progress?.completed != true }?.let { f ->
                LinearProgressIndicator(
                    progress = { f },
                    modifier = Modifier.fillMaxWidth().height(4.dp).align(Alignment.BottomCenter),
                )
            }
        }
        Text(
            item.title,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp, start = 2.dp, end = 2.dp),
        )
        val sub = item.subtitleLine()
        if (sub.isNotEmpty()) {
            Text(
                sub,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 2.dp),
            )
        }
    }
}
