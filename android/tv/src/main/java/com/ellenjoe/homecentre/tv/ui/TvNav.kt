package com.ellenjoe.homecentre.tv.ui

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.tv.material3.Text
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.tv.TvPlayerActivity

object TvRoutes {
    const val SPLASH = "splash"
    const val SETUP = "setup"
    const val LOGIN = "login"
    const val HOME = "home"
    const val BROWSE = "browse/{kind}"
    const val SERIES = "series"
    const val EPISODES = "episodes/{name}"
    const val SEARCH = "search"
    const val DETAIL = "detail/{id}"
    const val PHOTOS = "photos/{id}"

    fun browse(kind: String) = "browse/$kind"
    fun episodes(name: String) = "episodes/${Uri.encode(name)}"
    fun detail(id: String) = "detail/$id"
    fun photos(id: String) = "photos/$id"
}

class TvNav(private val nav: NavHostController, private val context: Context) {
    fun back() { nav.popBackStack() }
    fun go(route: String) = nav.navigate(route) { launchSingleTop = true }
    fun resetTo(route: String) = nav.navigate(route) {
        popUpTo(0) { inclusive = true }
        launchSingleTop = true
    }
    fun open(item: MediaItem) = if (item.kind == MediaKind.IMAGE) go(TvRoutes.photos(item.id)) else go(TvRoutes.detail(item.id))
    fun play(item: MediaItem, startSec: Double) {
        if (item.kind == MediaKind.IMAGE) go(TvRoutes.photos(item.id))
        else context.startActivity(TvPlayerActivity.intent(context, item.id, startSec))
    }
}

@Composable
fun TvNavHost() {
    val nav = rememberNavController()
    val ctx = LocalContext.current
    val actions = TvNav(nav, ctx)
    val repo = rememberRepository()
    val session by repo.session.collectAsStateWithLifecycle()
    val loaded by repo.loaded.collectAsStateWithLifecycle()

    LaunchedEffect(loaded, session.token) {
        val current = nav.currentDestination?.route
        if (loaded && session.token == null && current != null &&
            current !in setOf(TvRoutes.SPLASH, TvRoutes.SETUP, TvRoutes.LOGIN)
        ) actions.resetTo(if (session.serverUrl == null) TvRoutes.SETUP else TvRoutes.LOGIN)
    }

    NavHost(nav, startDestination = TvRoutes.SPLASH) {
        composable(TvRoutes.SPLASH) {
            LaunchedEffect(Unit) {
                val s = repo.load()
                actions.resetTo(
                    when {
                        s.serverUrl == null -> TvRoutes.SETUP
                        s.token == null -> TvRoutes.LOGIN
                        else -> TvRoutes.HOME
                    }
                )
            }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Home Centre", color = TvAccent) }
        }
        composable(TvRoutes.SETUP) { TvSetupScreen(onConnected = { actions.go(TvRoutes.LOGIN) }) }
        composable(TvRoutes.LOGIN) {
            TvLoginScreen(onLoggedIn = { actions.resetTo(TvRoutes.HOME) }, onChangeServer = { actions.resetTo(TvRoutes.SETUP) })
        }
        composable(TvRoutes.HOME) { TvHomeScreen(actions, onChangeServer = { actions.resetTo(TvRoutes.SETUP) }) }
        composable(TvRoutes.BROWSE, arguments = listOf(navArgument("kind") { type = NavType.StringType })) {
            TvBrowseScreen(it.arguments?.getString("kind") ?: "movies", actions)
        }
        composable(TvRoutes.SERIES) { TvSeriesScreen(actions) }
        composable(TvRoutes.EPISODES, arguments = listOf(navArgument("name") { type = NavType.StringType })) {
            TvEpisodesScreen(it.arguments?.getString("name").orEmpty(), actions)
        }
        composable(TvRoutes.SEARCH) { TvSearchScreen(actions) }
        composable(TvRoutes.DETAIL, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            TvDetailScreen(it.arguments?.getString("id").orEmpty(), actions)
        }
        composable(TvRoutes.PHOTOS, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            TvPhotoScreen(it.arguments?.getString("id").orEmpty(), actions)
        }
    }
}
