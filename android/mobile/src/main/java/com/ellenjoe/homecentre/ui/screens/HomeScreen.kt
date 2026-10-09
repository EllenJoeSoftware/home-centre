package com.ellenjoe.homecentre.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.model.SeriesSummary
import com.ellenjoe.homecentre.ui.Nav
import com.ellenjoe.homecentre.ui.Routes
import com.ellenjoe.homecentre.ui.common.Artwork
import com.ellenjoe.homecentre.ui.common.Load
import com.ellenjoe.homecentre.ui.common.MediaCard
import com.ellenjoe.homecentre.ui.common.rememberLoad
import com.ellenjoe.homecentre.ui.common.rememberRepository
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(nav: Nav, onChangeServer: () -> Unit) {
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }

    val (cont, _) = rememberLoad(refresh) { repo.continueWatching() }
    val (recent, _) = rememberLoad(refresh) { repo.recent(20) }
    val (movies, _) = rememberLoad(refresh) {
        repo.media(MediaKind.VIDEO, sort = "added", order = "desc", limit = 60).items.filter { it.series == null }.take(20)
    }
    val (shows, _) = rememberLoad(refresh) { repo.series() }
    val (music, _) = rememberLoad(refresh) { repo.media(MediaKind.AUDIO, sort = "added", order = "desc", limit = 20).items }
    val (photos, _) = rememberLoad(refresh) { repo.media(MediaKind.IMAGE, sort = "added", order = "desc", limit = 20).items }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Home Centre", color = MaterialTheme.colorScheme.primary) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                actions = {
                    IconButton(onClick = { nav.go(Routes.SEARCH) }) { Icon(Icons.Filled.Search, "Search") }
                    IconButton(onClick = { nav.go(Routes.LIBRARIES) }) { Icon(Icons.Filled.Folder, "Folders") }
                    IconButton(onClick = { nav.go(Routes.audio(null)) }) { Icon(Icons.Filled.MusicNote, "Now playing") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("All videos") }, onClick = { menu = false; nav.go(Routes.browse("videos")) })
                            DropdownMenuItem(text = { Text("Change server") }, onClick = { menu = false; onChangeServer() })
                            DropdownMenuItem(text = { Text("Sign out") }, onClick = { menu = false; scope.launch { repo.logout() } })
                        }
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = false,
            onRefresh = { refresh++ },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                item { MediaRow("Continue watching", cont, nav, hideWhenEmpty = true, onSeeAll = null) }
                item { MediaRow("Recently added", recent, nav, onSeeAll = null) }
                item { MediaRow("Movies", movies, nav, onSeeAll = { nav.go(Routes.browse("movies")) }) }
                item { SeriesRow(shows, nav) }
                item { MediaRow("Music", music, nav, onSeeAll = { nav.go(Routes.browse("music")) }) }
                item { MediaRow("Photos", photos, nav, onSeeAll = { nav.go(Routes.browse("photos")) }) }
            }
        }
    }
}

@Composable
private fun RowHeader(title: String, onSeeAll: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 16.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        if (onSeeAll != null) TextButton(onClick = onSeeAll) { Text("See all") }
    }
}

@Composable
private fun MediaRow(
    title: String,
    state: Load<List<MediaItem>>,
    nav: Nav,
    hideWhenEmpty: Boolean = false,
    onSeeAll: (() -> Unit)?,
) {
    if (hideWhenEmpty && (state !is Load.Ok || state.value.isEmpty())) return
    RowHeader(title, onSeeAll)
    when (state) {
        is Load.Loading -> Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        is Load.Err -> Text(state.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
        is Load.Ok -> if (state.value.isEmpty()) {
            Text("Nothing here yet", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        } else {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(state.value, key = { it.id }) { item ->
                    val w = if (item.kind == MediaKind.VIDEO) 200.dp else 130.dp
                    MediaCard(item, onClick = { nav.open(item) }, width = w)
                }
            }
        }
    }
}

@Composable
private fun SeriesRow(state: Load<List<SeriesSummary>>, nav: Nav) {
    RowHeader("TV Shows") { nav.go(Routes.SERIES) }
    when (state) {
        is Load.Loading -> Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is Load.Err -> Text(state.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
        is Load.Ok -> if (state.value.isEmpty()) {
            Text("No TV shows found", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        } else {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(state.value, key = { it.name }) { s -> SeriesCard(s, Modifier.width(200.dp)) { nav.go(Routes.episodes(s.name)) } }
            }
        }
    }
}

@Composable
fun SeriesCard(series: SeriesSummary, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val repo = rememberRepository()
    val url = series.thumbnailItemId?.let { id -> runCatching { repo.urls().thumbnail(id, 400) }.getOrNull() }
    Column(modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick)) {
        Artwork(url, MediaKind.VIDEO, Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp)))
        Text(series.name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Text(
            "${series.seasons.size} season${if (series.seasons.size == 1) "" else "s"} · ${series.episodeCount} episodes",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
