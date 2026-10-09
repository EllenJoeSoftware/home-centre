package com.ellenjoe.homecentre.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.ui.Nav
import com.ellenjoe.homecentre.ui.Routes
import com.ellenjoe.homecentre.ui.common.Artwork
import com.ellenjoe.homecentre.ui.common.ErrorBox
import com.ellenjoe.homecentre.ui.common.LoadContent
import com.ellenjoe.homecentre.ui.common.MediaCard
import com.ellenjoe.homecentre.ui.common.imageUrlFor
import com.ellenjoe.homecentre.ui.common.rememberLoad
import com.ellenjoe.homecentre.ui.common.rememberRepository
import com.ellenjoe.homecentre.ui.common.subtitleLine
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/** Offset-paged list of /api/media with optional client-side filter (e.g. movies = no series). */
class PagedMediaViewModel(
    private val repo: HomeCentreRepository,
    private val kind: MediaKind?,
    private val query: String?,
    private val filter: (MediaItem) -> Boolean,
) : ViewModel() {
    val items = mutableStateListOf<MediaItem>()
    var loading by mutableStateOf(false); private set
    var endReached by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var sort by mutableStateOf("title"); private set
    private var offset = 0

    init { loadMore() }

    fun changeSort(value: String) {
        if (value == sort) return
        sort = value
        items.clear(); offset = 0; endReached = false; error = null
        loadMore()
    }

    fun loadMore() {
        if (loading || endReached) return
        loading = true
        error = null
        viewModelScope.launch {
            try {
                var added = 0
                while (added == 0 && !endReached) {
                    val order = if (sort == "title") "asc" else "desc"
                    val page = repo.media(kind, query = query, sort = sort, order = order, offset = offset, limit = PAGE)
                    offset += page.items.size
                    val keep = page.items.filter(filter)
                    items.addAll(keep)
                    added += keep.size
                    endReached = page.items.isEmpty() || offset >= page.total
                }
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                loading = false
            }
        }
    }

    companion object { const val PAGE = 60 }
}

private data class BrowseSpec(val title: String, val kind: MediaKind?, val filter: (MediaItem) -> Boolean = { true })

private fun specFor(kind: String) = when (kind) {
    "movies" -> BrowseSpec("Movies", MediaKind.VIDEO) { it.series == null }
    "videos" -> BrowseSpec("All videos", MediaKind.VIDEO)
    "music" -> BrowseSpec("Music", MediaKind.AUDIO)
    "photos" -> BrowseSpec("Photos", MediaKind.IMAGE)
    else -> BrowseSpec("Library", null)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SimpleTopBar(title: String, onBack: () -> Unit, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, maxLines = 1) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@Composable
fun PagedGrid(vm: PagedMediaViewModel, nav: Nav, modifier: Modifier = Modifier) {
    val grid = rememberLazyGridState()
    LaunchedEffect(grid, vm) {
        snapshotFlow {
            val info = grid.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 12
        }.distinctUntilChanged().filter { it }.collect { vm.loadMore() }
    }
    if (vm.items.isEmpty() && vm.error != null) {
        ErrorBox(vm.error!!) { vm.loadMore() }
        return
    }
    if (vm.items.isEmpty() && vm.endReached) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Nothing here yet") }
        return
    }
    LazyVerticalGrid(
        state = grid,
        columns = GridCells.Adaptive(150.dp),
        contentPadding = PaddingValues(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = modifier.fillMaxSize(),
    ) {
        items(vm.items, key = { it.id }) { item -> MediaCard(item, onClick = { nav.open(item) }, width = null) }
        if (vm.loading || vm.error != null) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                    if (vm.loading) CircularProgressIndicator() else Text(vm.error.orEmpty(), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
fun BrowseScreen(kind: String, nav: Nav) {
    val repo = rememberRepository()
    val spec = remember(kind) { specFor(kind) }
    val vm: PagedMediaViewModel = viewModel(key = "browse-$kind") { PagedMediaViewModel(repo, spec.kind, null, spec.filter) }
    var menu by remember { mutableStateOf(false) }
    Scaffold(topBar = {
        SimpleTopBar(spec.title, nav::back) {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.AutoMirrored.Filled.Sort, "Sort") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    listOf("title" to "Title", "added" to "Recently added", "modified" to "Date modified", "size" to "Size", "duration" to "Duration")
                        .forEach { (key, label) ->
                            DropdownMenuItem(
                                text = { Text(if (vm.sort == key) "✓ $label" else label) },
                                onClick = { menu = false; vm.changeSort(key) },
                            )
                        }
                }
            }
        }
    }) { padding -> PagedGrid(vm, nav, Modifier.padding(padding)) }
}

@Composable
fun SeriesScreen(nav: Nav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad("series") { repo.series() }
    Scaffold(topBar = { SimpleTopBar("TV Shows", nav::back) }) { padding ->
        Box(Modifier.padding(padding)) {
            LoadContent(state, retry) { list ->
                if (list.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No TV shows found") }
                else LazyVerticalGrid(
                    columns = GridCells.Adaptive(170.dp),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    items(list, key = { it.name }) { s -> SeriesCard(s) { nav.go(Routes.episodes(s.name)) } }
                }
            }
        }
    }
}

@Composable
fun MediaListRow(item: MediaItem, onClick: () -> Unit) {
    val repo = rememberRepository()
    ListItem(
        headlineContent = { Text(item.title, maxLines = 2) },
        supportingContent = { item.subtitleLine().takeIf { it.isNotEmpty() }?.let { Text(it) } },
        leadingContent = {
            Artwork(
                imageUrlFor(repo, item, 200), item.kind,
                Modifier.size(if (item.kind == MediaKind.VIDEO) 96.dp else 56.dp, 56.dp),
            )
        },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
        modifier = Modifier.clickableRow(onClick),
    )
}

private fun Modifier.clickableRow(onClick: () -> Unit) = this.clickable(onClick = onClick)

@Composable
fun EpisodesScreen(name: String, nav: Nav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad(name) { repo.episodes(name) }
    Scaffold(topBar = { SimpleTopBar(name, nav::back) }) { padding ->
        Box(Modifier.padding(padding)) {
            LoadContent(state, retry) { eps ->
                val bySeason = eps.groupBy { it.series?.season ?: 0 }.toSortedMap()
                LazyColumn(Modifier.fillMaxSize()) {
                    bySeason.forEach { (season, list) ->
                        item(key = "season-$season") {
                            Text(
                                if (season == 0) "Specials" else "Season $season",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                            )
                        }
                        items(list, key = { it.id }) { ep -> MediaListRow(ep) { nav.open(ep) } }
                    }
                }
            }
        }
    }
}

@Composable
fun LibrariesScreen(nav: Nav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad("libraries") { repo.libraries() }
    Scaffold(topBar = { SimpleTopBar("Folders", nav::back) }) { padding ->
        Box(Modifier.padding(padding)) {
            LoadContent(state, retry) { libs ->
                LazyColumn(Modifier.fillMaxSize()) {
                    items(libs, key = { it.id }) { lib ->
                        ListItem(
                            headlineContent = { Text(lib.name) },
                            supportingContent = { Text("${lib.itemCount} items") },
                            leadingContent = { Icon(Icons.Filled.Folder, null, tint = MaterialTheme.colorScheme.primary) },
                            colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                            modifier = Modifier.clickableRow { nav.go(Routes.folder(lib.id, "", lib.name)) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
fun FolderScreen(libraryId: String, path: String, title: String, nav: Nav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad(libraryId, path) { repo.folders(libraryId, path) }
    val heading = path.substringAfterLast('/').ifEmpty { title.ifEmpty { "Folder" } }
    Scaffold(topBar = { SimpleTopBar(heading, nav::back) }) { padding ->
        Box(Modifier.padding(padding)) {
            LoadContent(state, retry) { listing ->
                if (listing.folders.isEmpty() && listing.items.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Empty folder") }
                } else LazyColumn(Modifier.fillMaxSize()) {
                    items(listing.folders, key = { "f:" + it.path }) { f ->
                        ListItem(
                            headlineContent = { Text(f.name) },
                            leadingContent = { Icon(Icons.Filled.Folder, null, tint = MaterialTheme.colorScheme.primary) },
                            colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                            modifier = Modifier.clickableRow { nav.go(Routes.folder(libraryId, f.path, title)) },
                        )
                    }
                    items(listing.items, key = { it.id }) { item -> MediaListRow(item) { nav.open(item) } }
                }
            }
        }
    }
}

@Composable
fun SearchScreen(nav: Nav) {
    val repo = rememberRepository()
    var query by rememberSaveable { mutableStateOf("") }
    var debounced by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        delay(400)
        debounced = query.trim()
    }
    Scaffold(topBar = { SimpleTopBar("Search", nav::back) }) { padding ->
        androidx.compose.foundation.layout.Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                placeholder = { Text("Titles, files, artists, albums") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { debounced = query.trim() }),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).focusRequester(focus),
            )
            if (debounced.length >= 2) {
                val vm: PagedMediaViewModel = viewModel(key = "search-$debounced") {
                    PagedMediaViewModel(repo, null, debounced) { true }
                }
                PagedGrid(vm, nav)
            } else {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Type at least 2 characters", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
