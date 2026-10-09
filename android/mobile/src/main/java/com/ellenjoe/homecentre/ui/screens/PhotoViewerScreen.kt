package com.ellenjoe.homecentre.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.ui.Nav
import com.ellenjoe.homecentre.ui.common.LoadContent
import com.ellenjoe.homecentre.ui.common.rememberLoad
import com.ellenjoe.homecentre.ui.common.rememberRepository

@Composable
fun PhotoViewerScreen(id: String, nav: Nav) {
    val repo = rememberRepository()
    val (state, retry) = rememberLoad(id) {
        val item = repo.item(id)
        val list = repo.siblings(item, MediaKind.IMAGE)
        list to list.indexOfFirst { it.id == id }.coerceAtLeast(0)
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        LoadContent(state, retry) { (photos, start) ->
            val pager = rememberPagerState(initialPage = start) { photos.size }
            var chrome by remember { mutableStateOf(true) }
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1, key = { photos[it].id }) { page ->
                val photo = photos[page]
                SubcomposeAsyncImage(
                    model = repo.urls().stream(photo.id),
                    contentDescription = photo.title,
                    contentScale = ContentScale.Fit,
                    loading = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } },
                    error = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Cannot load image") } },
                    modifier = Modifier.fillMaxSize().clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { chrome = !chrome },
                )
            }
            if (chrome) {
                Row(
                    Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.5f)).statusBarsPadding().padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) }
                    Text(
                        "${photos[pager.currentPage].title}  (${pager.currentPage + 1}/${photos.size})",
                        color = Color.White,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
