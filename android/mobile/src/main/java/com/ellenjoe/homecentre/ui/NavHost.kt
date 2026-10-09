package com.ellenjoe.homecentre.ui

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.player.VideoPlayerActivity
import com.ellenjoe.homecentre.ui.common.rememberRepository
import com.ellenjoe.homecentre.ui.screens.AudioPlayerScreen
import com.ellenjoe.homecentre.ui.screens.BrowseScreen
import com.ellenjoe.homecentre.ui.screens.DetailScreen
import com.ellenjoe.homecentre.ui.screens.EpisodesScreen
import com.ellenjoe.homecentre.ui.screens.FolderScreen
import com.ellenjoe.homecentre.ui.screens.HomeScreen
import com.ellenjoe.homecentre.ui.screens.LibrariesScreen
import com.ellenjoe.homecentre.ui.screens.LoginScreen
import com.ellenjoe.homecentre.ui.screens.PhotoViewerScreen
import com.ellenjoe.homecentre.ui.screens.SearchScreen
import com.ellenjoe.homecentre.ui.screens.SeriesScreen
import com.ellenjoe.homecentre.ui.screens.SetupScreen

object Routes {
    const val SPLASH = "splash"
    const val SETUP = "setup"
    const val LOGIN = "login"
    const val HOME = "home"
    const val BROWSE = "browse/{kind}"
    const val SERIES = "series"
    const val EPISODES = "episodes/{name}"
    const val LIBRARIES = "libraries"
    const val FOLDER = "folder/{libraryId}?path={path}&title={title}"
    const val SEARCH = "search"
    const val DETAIL = "detail/{id}"
    const val AUDIO = "audio?id={id}"
    const val PHOTOS = "photos/{id}"

    fun browse(kind: String) = "browse/$kind"
    fun episodes(name: String) = "episodes/${Uri.encode(name)}"
    fun folder(libraryId: String, path: String, title: String) =
        "folder/${Uri.encode(libraryId)}?path=${Uri.encode(path)}&title=${Uri.encode(title)}"
    fun detail(id: String) = "detail/$id"
    fun audio(id: String?) = if (id == null) "audio" else "audio?id=$id"
    fun photos(id: String) = "photos/$id"
}

/** Navigation actions shared by screens. */
class Nav(private val nav: NavHostController, private val context: Context) {
    fun back() { nav.popBackStack() }
    fun go(route: String) = nav.navigate(route) { launchSingleTop = true }
    fun open(item: MediaItem) = when (item.kind) {
        MediaKind.IMAGE -> go(Routes.photos(item.id))
        else -> go(Routes.detail(item.id))
    }
    fun play(item: MediaItem) = when (item.kind) {
        MediaKind.VIDEO -> context.startActivity(VideoPlayerActivity.intent(context, item.id))
        MediaKind.AUDIO -> go(Routes.audio(item.id))
        MediaKind.IMAGE -> go(Routes.photos(item.id))
    }
    fun resetTo(route: String) = nav.navigate(route) {
        popUpTo(0) { inclusive = true }
        launchSingleTop = true
    }
}

@Composable
fun HomeCentreNavHost() {
    val nav = rememberNavController()
    val ctx = LocalContext.current
    val actions = Nav(nav, ctx)
    val repo = rememberRepository()
    val session by repo.session.collectAsStateWithLifecycle()
    val loaded by repo.loaded.collectAsStateWithLifecycle()

    // Session expired / signed out anywhere → back to login.
    LaunchedEffect(loaded, session.token) {
        val current = nav.currentDestination?.route
        if (loaded && session.token == null && current != null &&
            current !in setOf(Routes.SPLASH, Routes.SETUP, Routes.LOGIN)
        ) {
            actions.resetTo(if (session.serverUrl == null) Routes.SETUP else Routes.LOGIN)
        }
    }

    NavHost(navController = nav, startDestination = Routes.SPLASH) {
        composable(Routes.SPLASH) {
            LaunchedEffect(Unit) {
                val s = repo.load()
                actions.resetTo(
                    when {
                        s.serverUrl == null -> Routes.SETUP
                        s.token == null -> Routes.LOGIN
                        else -> Routes.HOME
                    }
                )
            }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
        composable(Routes.SETUP) { SetupScreen(onConnected = { actions.go(Routes.LOGIN) }) }
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoggedIn = { actions.resetTo(Routes.HOME) },
                onChangeServer = { actions.resetTo(Routes.SETUP) },
            )
        }
        composable(Routes.HOME) { HomeScreen(actions, onChangeServer = { actions.resetTo(Routes.SETUP) }) }
        composable(Routes.BROWSE, arguments = listOf(navArgument("kind") { type = NavType.StringType })) {
            BrowseScreen(it.arguments?.getString("kind") ?: "movies", actions)
        }
        composable(Routes.SERIES) { SeriesScreen(actions) }
        composable(Routes.EPISODES, arguments = listOf(navArgument("name") { type = NavType.StringType })) {
            EpisodesScreen(it.arguments?.getString("name").orEmpty(), actions)
        }
        composable(Routes.LIBRARIES) { LibrariesScreen(actions) }
        composable(
            Routes.FOLDER,
            arguments = listOf(
                navArgument("libraryId") { type = NavType.StringType },
                navArgument("path") { type = NavType.StringType; defaultValue = "" },
                navArgument("title") { type = NavType.StringType; defaultValue = "" },
            ),
        ) {
            FolderScreen(
                libraryId = it.arguments?.getString("libraryId").orEmpty(),
                path = it.arguments?.getString("path").orEmpty(),
                title = it.arguments?.getString("title").orEmpty(),
                nav = actions,
            )
        }
        composable(Routes.SEARCH) { SearchScreen(actions) }
        composable(Routes.DETAIL, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            DetailScreen(it.arguments?.getString("id").orEmpty(), actions)
        }
        composable(
            Routes.AUDIO,
            arguments = listOf(navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null }),
        ) {
            AudioPlayerScreen(it.arguments?.getString("id"), actions)
        }
        composable(Routes.PHOTOS, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            PhotoViewerScreen(it.arguments?.getString("id").orEmpty(), actions)
        }
    }
}
