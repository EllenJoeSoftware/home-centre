package com.ellenjoe.homecentre.tv.ui

import android.view.KeyEvent as NativeKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.Button
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.OutlinedButton
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.model.SeriesSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- Setup / Login

@Composable
private fun TvFormScaffold(title: String, subtitle: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Home Centre", style = MaterialTheme.typography.displaySmall, color = TvAccent)
            Spacer(Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.headlineSmall)
            Text(subtitle, color = TvMuted)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) { content() }
    }
}

@Composable
fun TvSetupScreen(onConnected: () -> Unit) {
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    var url by rememberSaveable { mutableStateOf(repo.session.value.serverUrl ?: "http://") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    AutoFocus(focus)

    fun connect() {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { repo.connect(url); onConnected() } catch (e: Exception) { error = e.userMessage() } finally { busy = false }
        }
    }

    TvFormScaffold("Connect to your server", "Enter the address shown by your Home Centre server, e.g. http://192.168.1.10:8096") {
        TvTextField(url, { url = it }, "Server address", Modifier.focusRequester(focus),
            keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, onImeAction = ::connect)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = ::connect, enabled = !busy) { Text(if (busy) "Connecting…" else "Connect") }
    }
}

@Composable
fun TvLoginScreen(onLoggedIn: () -> Unit, onChangeServer: () -> Unit) {
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    AutoFocus(focus)

    fun login() {
        if (busy || username.isBlank()) return
        busy = true; error = null
        scope.launch {
            try { repo.login(username, password); onLoggedIn() } catch (e: Exception) { error = e.userMessage() } finally { busy = false }
        }
    }

    TvFormScaffold("Sign in", repo.session.value.serverUrl.orEmpty()) {
        TvTextField(username, { username = it }, "Username", Modifier.focusRequester(focus))
        TvTextField(password, { password = it }, "Password", password = true, imeAction = ImeAction.Done, onImeAction = ::login)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Button(onClick = ::login, enabled = !busy) { Text(if (busy) "Signing in…" else "Sign in") }
            OutlinedButton(onClick = onChangeServer) { Text("Change server") }
        }
    }
}

// ---------------------------------------------------------------- Home

@Composable
fun TvHomeScreen(nav: TvNav, onChangeServer: () -> Unit) {
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        var first = true
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { if (!first) refresh++; first = false }
    }
    val (cont, _) = rememberLoad(refresh) { repo.continueWatching() }
    val (recent, _) = rememberLoad("recent") { repo.recent(20) }
    val (movies, _) = rememberLoad("movies") {
        repo.media(MediaKind.VIDEO, sort = "added", order = "desc", limit = 60).items.filter { it.series == null }.take(20)
    }
    val (shows, _) = rememberLoad("shows") { repo.series() }
    val (music, _) = rememberLoad("music") { repo.media(MediaKind.AUDIO, sort = "added", order = "desc", limit = 20).items }
    val (photos, _) = rememberLoad("photos") { repo.media(MediaKind.IMAGE, sort = "added", order = "desc", limit = 20).items }

    val focus = remember { FocusRequester() }
    AutoFocus(focus)
    val listState = rememberLazyListState()

    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 48.dp)) {
        item("top") {
            Row(
                Modifier.fillMaxWidth().padding(start = 48.dp, end = 48.dp, top = 28.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Home Centre", style = MaterialTheme.typography.headlineSmall, color = TvAccent, modifier = Modifier.padding(end = 24.dp))
                Button(onClick = { nav.go(TvRoutes.SEARCH) }) {
                    Icon(Icons.Filled.Search, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Search")
                }
                Button(onClick = { nav.go(TvRoutes.browse("movies")) }, modifier = Modifier.focusRequester(focus)) { Text("Movies") }
                Button(onClick = { nav.go(TvRoutes.SERIES) }) { Text("TV Shows") }
                Button(onClick = { nav.go(TvRoutes.browse("music")) }) { Text("Music") }
                Button(onClick = { nav.go(TvRoutes.browse("photos")) }) { Text("Photos") }
                Spacer(Modifier.weight(1f))
                OutlinedButton(onClick = onChangeServer) { Text("Server") }
                OutlinedButton(onClick = { scope.launch { repo.logout() } }) { Text("Sign out") }
            }
        }
        item("continue") { ItemRow("Continue watching", cont, nav, hideWhenEmpty = true) }
        item("recent") { ItemRow("Recently added", recent, nav) }
        item("movies") { ItemRow("Movies", movies, nav) }
        item("shows") { SeriesRow(shows, nav) }
        item("music") { ItemRow("Music", music, nav) }
        item("photos") { ItemRow("Photos", photos, nav) }
    }
}

@Composable
private fun ItemRow(title: String, state: Load<List<MediaItem>>, nav: TvNav, hideWhenEmpty: Boolean = false) {
    when (state) {
        is Load.Loading -> if (!hideWhenEmpty) Text("$title — loading…", color = TvMuted, modifier = Modifier.padding(start = 48.dp, top = 20.dp))
        is Load.Err -> if (!hideWhenEmpty) Text("$title — ${state.message}", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 48.dp, top = 20.dp))
        is Load.Ok -> if (state.value.isNotEmpty()) {
            TvRow(title, state.value, key = { it.id }) { item -> TvItemCard(item, onClick = { nav.open(item) }) }
        } else if (!hideWhenEmpty) {
            Text("$title — nothing here yet", color = TvMuted, modifier = Modifier.padding(start = 48.dp, top = 20.dp))
        }
    }
}

@Composable
private fun SeriesRow(state: Load<List<SeriesSummary>>, nav: TvNav) {
    val repo = rememberRepository()
    if (state is Load.Ok && state.value.isNotEmpty()) {
        TvRow("TV Shows", state.value, key = { it.name }) { s -> SeriesCard(repo, s) { nav.go(TvRoutes.episodes(s.name)) } }
    }
}

@Composable
private fun SeriesCard(repo: HomeCentreRepository, s: SeriesSummary, onClick: () -> Unit) {
    TvMediaCard(
        title = s.name,
        subtitle = "${s.seasons.size} season${if (s.seasons.size == 1) "" else "s"} · ${s.episodeCount} episodes",
        imageUrl = s.thumbnailItemId?.let { id -> runCatching { repo.urls().thumbnail(id, 480) }.getOrNull() },
        kind = MediaKind.VIDEO,
        onClick = onClick,
    )
}

// ---------------------------------------------------------------- Browse / paging

class TvPagedViewModel(
    private val repo: HomeCentreRepository,
    private val kind: MediaKind?,
    private val query: String?,
    private val filter: (MediaItem) -> Boolean,
) : ViewModel() {
    val items = mutableStateListOf<MediaItem>()
    var loading by mutableStateOf(false); private set
    var endReached by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var offset = 0

    init { loadMore() }

    fun loadMore() {
        if (loading || endReached) return
        loading = true; error = null
        viewModelScope.launch {
            try {
                var added = 0
                while (added == 0 && !endReached) {
                    val page = repo.media(kind, query = query, sort = if (kind == null) "title" else "title", order = "asc", offset = offset, limit = 60)
                    offset += page.items.size
                    val keep = page.items.filter(filter)
                    items.addAll(keep); added += keep.size
                    endReached = page.items.isEmpty() || offset >= page.total
                }
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                loading = false
            }
        }
    }
}

@Composable
private fun TvPagedGrid(vm: TvPagedViewModel, nav: TvNav, focusFirst: Boolean = true) {
    val grid = rememberLazyGridState()
    LaunchedEffect(grid, vm) {
        snapshotFlow {
            val info = grid.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 10
        }.distinctUntilChanged().filter { it }.collect { vm.loadMore() }
    }
    val first = remember { FocusRequester() }
    if (focusFirst && vm.items.isNotEmpty()) AutoFocus(first, key = vm)
    when {
        vm.items.isEmpty() && vm.error != null -> Text(vm.error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(48.dp))
        vm.items.isEmpty() && vm.endReached -> Text("Nothing here yet", color = TvMuted, modifier = Modifier.padding(48.dp))
        vm.items.isEmpty() -> Text("Loading…", color = TvMuted, modifier = Modifier.padding(48.dp))
        else -> LazyVerticalGrid(
            state = grid,
            columns = GridCells.Adaptive(200.dp),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(vm.items.size, key = { vm.items[it].id }) { i ->
                val item = vm.items[i]
                TvItemCard(item, onClick = { nav.open(item) }, width = 200.dp,
                    modifier = if (i == 0) Modifier.focusRequester(first) else Modifier)
            }
            if (vm.loading) item(span = { GridItemSpan(maxLineSpan) }) { Text("Loading…", color = TvMuted) }
        }
    }
}

@Composable
private fun ScreenTitle(title: String) {
    Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(start = 48.dp, top = 28.dp, bottom = 8.dp))
}

@Composable
fun TvBrowseScreen(kind: String, nav: TvNav) {
    val repo = rememberRepository()
    val (title, mk, filter) = when (kind) {
        "movies" -> Triple("Movies", MediaKind.VIDEO) { m: MediaItem -> m.series == null }
        "music" -> Triple("Music", MediaKind.AUDIO) { _: MediaItem -> true }
        "photos" -> Triple("Photos", MediaKind.IMAGE) { _: MediaItem -> true }
        else -> Triple("Videos", MediaKind.VIDEO) { _: MediaItem -> true }
    }
    val vm: TvPagedViewModel = viewModel(key = "tv-browse-$kind") { TvPagedViewModel(repo, mk, null, filter) }
    Column(Modifier.fillMaxSize()) {
        ScreenTitle(title)
        TvPagedGrid(vm, nav)
    }
}

@Composable
fun TvSeriesScreen(nav: TvNav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad("series") { repo.series() }
    Column(Modifier.fillMaxSize()) {
        ScreenTitle("TV Shows")
        LoadContent(state, retry) { list ->
            val first = remember { FocusRequester() }
            if (list.isNotEmpty()) AutoFocus(first)
            LazyVerticalGrid(
                columns = GridCells.Adaptive(220.dp),
                contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                items(list.size, key = { list[it].name }) { i ->
                    val s = list[i]
                    Box(if (i == 0) Modifier.focusRequester(first) else Modifier) {
                        SeriesCard(repo, s) { nav.go(TvRoutes.episodes(s.name)) }
                    }
                }
            }
        }
    }
}

@Composable
fun TvEpisodesScreen(name: String, nav: TvNav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad(name) { repo.episodes(name) }
    Column(Modifier.fillMaxSize()) {
        ScreenTitle(name)
        LoadContent(state, retry) { eps ->
            val seasons = eps.groupBy { it.series?.season ?: 0 }.toSortedMap()
            val first = remember { FocusRequester() }
            if (eps.isNotEmpty()) AutoFocus(first)
            LazyColumn(contentPadding = PaddingValues(bottom = 48.dp)) {
                seasons.entries.forEachIndexed { idx, (season, list) ->
                    item(key = "s$season") {
                        Box(if (idx == 0) Modifier.focusRequester(first) else Modifier) {
                            TvRow(if (season == 0) "Specials" else "Season $season", list, key = { it.id }) { ep ->
                                TvItemCard(ep, onClick = { nav.open(ep) })
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Search

@Composable
fun TvSearchScreen(nav: TvNav) {
    val repo = rememberRepository()
    var query by rememberSaveable { mutableStateOf("") }
    var debounced by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    AutoFocus(focus)
    LaunchedEffect(query) { delay(500); debounced = query.trim() }
    Column(Modifier.fillMaxSize()) {
        ScreenTitle("Search")
        TvTextField(
            query, { query = it }, "Titles, files, artists, albums",
            Modifier.padding(horizontal = 48.dp).width(560.dp).focusRequester(focus),
            imeAction = ImeAction.Search, onImeAction = { debounced = query.trim() },
        )
        if (debounced.length >= 2) {
            val vm: TvPagedViewModel = viewModel(key = "tv-search-$debounced") { TvPagedViewModel(repo, null, debounced) { true } }
            TvPagedGrid(vm, nav, focusFirst = false)
        }
    }
}

// ---------------------------------------------------------------- Detail

@Composable
fun TvDetailScreen(id: String, nav: TvNav) {
    val repo = rememberRepository()
    var refresh by remember { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        var first = true
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { if (!first) refresh++; first = false }
    }
    val (state, retry) = rememberLoad(id, refresh) { repo.item(id) }
    LoadContent(state, retry) { item ->
        val playFocus = remember { FocusRequester() }
        AutoFocus(playFocus, key = item.id)
        Row(Modifier.fillMaxSize().padding(48.dp), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
            Artwork(
                imageUrlFor(repo, item, 960), item.kind,
                Modifier.width(if (item.kind == MediaKind.VIDEO) 440.dp else 300.dp)
                    .aspectRatio(if (item.kind == MediaKind.VIDEO) 16f / 9f else 1f),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item.series?.let { Text(it.name, color = TvAccent) }
                Text(item.title, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val sub = item.subtitleLine()
                if (sub.isNotEmpty()) Text(sub, color = TvMuted)
                val tech = listOfNotNull(
                    if (item.width != null && item.height != null) "${item.width}×${item.height}" else null,
                    item.videoCodec, item.audioCodec, item.container, item.album,
                ).joinToString(" · ")
                if (tech.isNotEmpty()) Text(tech, color = TvMuted, style = MaterialTheme.typography.bodySmall)
                if (item.subtitles.isNotEmpty()) Text("Subtitles: " + item.subtitles.joinToString { it.label }, color = TvMuted, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    val resume = item.resumePositionSec
                    if (resume != null) {
                        Button(onClick = { nav.play(item, resume) }, modifier = Modifier.focusRequester(playFocus)) {
                            Icon(Icons.Filled.PlayArrow, null, Modifier.size(20.dp)); Spacer(Modifier.width(6.dp))
                            Text("Resume ${formatDuration(resume)}")
                        }
                        OutlinedButton(onClick = { nav.play(item, 0.0) }) {
                            Icon(Icons.Filled.Replay, null, Modifier.size(20.dp)); Spacer(Modifier.width(6.dp)); Text("Start over")
                        }
                    } else {
                        Button(onClick = { nav.play(item, 0.0) }, modifier = Modifier.focusRequester(playFocus)) {
                            Icon(Icons.Filled.PlayArrow, null, Modifier.size(20.dp)); Spacer(Modifier.width(6.dp)); Text("Play")
                        }
                    }
                    item.series?.let { s ->
                        OutlinedButton(onClick = { nav.go(TvRoutes.episodes(s.name)) }) {
                            Icon(Icons.AutoMirrored.Filled.List, null, Modifier.size(20.dp)); Spacer(Modifier.width(6.dp)); Text("Episodes")
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Photos

@Composable
fun TvPhotoScreen(id: String, nav: TvNav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad(id) {
        val item = repo.item(id)
        val list = repo.siblings(item, MediaKind.IMAGE)
        list to list.indexOfFirst { it.id == id }.coerceAtLeast(0)
    }
    LoadContent(state, retry) { (photos, start) ->
        var index by rememberSaveable { mutableIntStateOf(start) }
        val focus = remember { FocusRequester() }
        AutoFocus(focus)
        Box(
            Modifier.fillMaxSize().background(Color.Black)
                .focusRequester(focus)
                .onKeyEvent { ev ->
                    val n = ev.nativeKeyEvent
                    if (n.action != NativeKeyEvent.ACTION_DOWN) return@onKeyEvent false
                    when (n.keyCode) {
                        NativeKeyEvent.KEYCODE_DPAD_LEFT, NativeKeyEvent.KEYCODE_MEDIA_PREVIOUS -> { if (index > 0) index--; true }
                        NativeKeyEvent.KEYCODE_DPAD_RIGHT, NativeKeyEvent.KEYCODE_MEDIA_NEXT -> { if (index < photos.lastIndex) index++; true }
                        else -> false
                    }
                }
                .focusable(),
        ) {
            val photo = photos[index]
            AsyncImage(model = repo.urls().stream(photo.id), contentDescription = photo.title, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            Text(
                "${photo.title}   ${index + 1} / ${photos.size}   ◀ ▶",
                color = Color.White,
                modifier = Modifier.align(Alignment.BottomCenter).background(Color.Black.copy(alpha = 0.5f)).padding(horizontal = 16.dp, vertical = 8.dp),
            )
            // Preload neighbours.
            photos.getOrNull(index + 1)?.let { AsyncImage(model = repo.urls().stream(it.id), contentDescription = null, modifier = Modifier.size(1.dp)) }
        }
    }
}
