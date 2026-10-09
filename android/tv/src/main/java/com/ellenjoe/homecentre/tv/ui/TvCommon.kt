package com.ellenjoe.homecentre.tv.ui

import android.view.KeyEvent as NativeKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import androidx.tv.material3.darkColorScheme
import coil.compose.AsyncImage
import com.ellenjoe.homecentre.core.HomeCentre
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind

val TvBackground = Color(0xFF0B0F14)
val TvAccent = Color(0xFF14B8A6)
val TvSurface = Color(0xFF1C2530)
val TvMuted = Color(0xFF9AA7B4)

@Composable
fun TvTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = TvAccent,
            onPrimary = Color(0xFF00201C),
            background = TvBackground,
            onBackground = Color(0xFFE6EDF3),
            surface = TvBackground,
            onSurface = Color(0xFFE6EDF3),
            surfaceVariant = TvSurface,
            onSurfaceVariant = TvMuted,
            border = TvAccent,
            error = Color(0xFFF87171),
        ),
    ) {
        Box(Modifier.fillMaxSize().background(TvBackground)) { content() }
    }
}

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
        is Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Loading…", color = TvMuted) }
        is Load.Err -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(state.message, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(12.dp))
            val fr = remember { FocusRequester() }
            Button(onClick = onRetry, modifier = Modifier.focusRequester(fr)) { Text("Retry") }
            LaunchedEffect(Unit) { runCatching { fr.requestFocus() } }
        }
        is Load.Ok -> content(state.value)
    }
}

/** Requests focus once the node is attached (safe if it is not). */
@Composable
fun AutoFocus(requester: FocusRequester, key: Any? = Unit) {
    LaunchedEffect(key) {
        repeat(5) {
            if (runCatching { requester.requestFocus() }.isSuccess) return@LaunchedEffect
            kotlinx.coroutines.delay(50)
        }
    }
}

fun imageUrlFor(repo: HomeCentreRepository, item: MediaItem, width: Int = 480): String? = runCatching {
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
fun Artwork(url: String?, kind: MediaKind, modifier: Modifier = Modifier) {
    Box(modifier.background(TvSurface), contentAlignment = Alignment.Center) {
        Icon(
            when (kind) {
                MediaKind.VIDEO -> Icons.Filled.Movie
                MediaKind.AUDIO -> Icons.Filled.MusicNote
                MediaKind.IMAGE -> Icons.Filled.Image
            },
            contentDescription = null,
            tint = TvMuted,
            modifier = Modifier.size(40.dp),
        )
        if (url != null) AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

/** Focusable card (tv-material Card scales/glows on focus) with title below. */
@Composable
fun TvMediaCard(
    title: String,
    subtitle: String,
    imageUrl: String?,
    kind: MediaKind,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = 220.dp,
    ratio: Float = if (kind == MediaKind.VIDEO) 16f / 9f else 1f,
    progress: Float? = null,
) {
    Column(modifier.width(width)) {
        Card(onClick = onClick, modifier = Modifier.fillMaxWidth().aspectRatio(ratio)) {
            Box(Modifier.fillMaxSize()) {
                Artwork(imageUrl, kind, Modifier.fillMaxSize())
                if (progress != null && progress > 0f) {
                    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color.Black.copy(alpha = 0.5f))) {
                        Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(TvAccent))
                    }
                }
            }
        }
        Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        if (subtitle.isNotEmpty()) {
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = TvMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun TvItemCard(item: MediaItem, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp? = null) {
    val repo = rememberRepository()
    TvMediaCard(
        title = item.title,
        subtitle = item.subtitleLine(),
        imageUrl = imageUrlFor(repo, item),
        kind = item.kind,
        onClick = onClick,
        modifier = modifier,
        width = width ?: if (item.kind == MediaKind.VIDEO) 220.dp else 140.dp,
        progress = item.progressFraction?.takeIf { item.progress?.completed != true },
    )
}

/** Horizontal row that remembers the last focused child when focus re-enters. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun <T> TvRow(title: String, items: List<T>, key: (T) -> Any, itemContent: @Composable (T) -> Unit) {
    Column(Modifier.padding(top = 20.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 48.dp, bottom = 10.dp))
        LazyRow(
            modifier = Modifier.focusRestorer(),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            items(items, key = key) { itemContent(it) }
        }
    }
}

/**
 * D-pad friendly text field: focus highlights it; OK/Enter opens the on-screen keyboard.
 */
@Composable
fun TvTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    onImeAction: () -> Unit = {},
) {
    var focused by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = if (focused) TvAccent else TvMuted)
        Spacer(Modifier.height(6.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = Color.White, fontSize = 20.sp),
            cursorBrush = SolidColor(TvAccent),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { keyboard?.hide(); onImeAction() }),
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { focused = it.isFocused }
                .onPreviewKeyEvent { ev ->
                    val native = ev.nativeKeyEvent
                    if (native.action == NativeKeyEvent.ACTION_UP &&
                        (native.keyCode == NativeKeyEvent.KEYCODE_DPAD_CENTER || native.keyCode == NativeKeyEvent.KEYCODE_ENTER)
                    ) {
                        keyboard?.show(); true
                    } else false
                }
                .border(2.dp, if (focused) TvAccent else TvSurface, RoundedCornerShape(8.dp))
                .background(TvSurface, RoundedCornerShape(8.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}
