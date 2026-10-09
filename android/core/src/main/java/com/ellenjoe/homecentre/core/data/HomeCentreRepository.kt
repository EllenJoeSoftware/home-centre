package com.ellenjoe.homecentre.core.data

import com.ellenjoe.homecentre.core.api.ApiClient
import com.ellenjoe.homecentre.core.api.HomeCentreApi
import com.ellenjoe.homecentre.core.api.HomeCentreJson
import com.ellenjoe.homecentre.core.model.ApiError
import com.ellenjoe.homecentre.core.model.FolderListing
import com.ellenjoe.homecentre.core.model.Library
import com.ellenjoe.homecentre.core.model.LoginRequest
import com.ellenjoe.homecentre.core.model.MediaItem
import com.ellenjoe.homecentre.core.model.MediaKind
import com.ellenjoe.homecentre.core.model.Page
import com.ellenjoe.homecentre.core.model.Progress
import com.ellenjoe.homecentre.core.model.ProgressUpdate
import com.ellenjoe.homecentre.core.model.SeriesSummary
import com.ellenjoe.homecentre.core.model.ServerInfo
import com.ellenjoe.homecentre.core.model.User
import com.ellenjoe.homecentre.core.playback.PlaybackUrls
import com.ellenjoe.homecentre.core.settings.ServerSettings
import com.ellenjoe.homecentre.core.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import retrofit2.HttpException
import java.io.IOException

class NotConfiguredException : IllegalStateException("No server configured")

/** Turns any failure into a short, user-facing message. */
fun Throwable.userMessage(): String = when (this) {
    is HttpException -> {
        val body = runCatching { response()?.errorBody()?.string() }.getOrNull()
        val parsed = body?.let { runCatching { HomeCentreJson.decodeFromString(ApiError.serializer(), it).error }.getOrNull() }
        parsed ?: when (code()) {
            401 -> "Invalid credentials or session expired"
            404 -> "Not found"
            else -> "Server error (${code()})"
        }
    }
    is IOException -> "Cannot reach server: ${message ?: javaClass.simpleName}"
    else -> message ?: javaClass.simpleName
}

class HomeCentreRepository(private val settingsStore: SettingsStore) {

    /** Scope for fire-and-forget work that must outlive screens (e.g. final progress report). */
    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _session = MutableStateFlow(ServerSettings())
    val session: StateFlow<ServerSettings> = _session.asStateFlow()

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    private val loadMutex = Mutex()

    /** Shared client; adds the bearer token of the current session. */
    val okHttp: OkHttpClient = ApiClient.okHttpClient { _session.value.token }

    @Volatile
    private var cachedApi: Pair<HttpUrl, HomeCentreApi>? = null

    suspend fun load(): ServerSettings = loadMutex.withLock {
        if (!_loaded.value) {
            _session.value = settingsStore.snapshot()
            _loaded.value = true
        }
        _session.value
    }

    val baseUrl: HttpUrl?
        get() = _session.value.serverUrl?.toHttpUrlOrNull()

    private fun apiFor(base: HttpUrl): HomeCentreApi {
        cachedApi?.let { (url, api) -> if (url == base) return api }
        val api = ApiClient.create(base, okHttp)
        cachedApi = base to api
        return api
    }

    fun api(): HomeCentreApi = apiFor(baseUrl ?: throw NotConfiguredException())

    fun urls(): PlaybackUrls = PlaybackUrls(baseUrl ?: throw NotConfiguredException(), _session.value.token)

    /** Validates a user-entered server URL via /api/server/info and persists it. */
    suspend fun connect(input: String): ServerInfo {
        val base = ApiClient.normalizeServerUrl(input)
            ?: throw IllegalArgumentException("Invalid server address")
        val info = apiFor(base).serverInfo()
        // Older servers omit `product`; anything that reports a different product is not ours.
        if (info.product != null && info.product != ServerInfo.PRODUCT) {
            throw IllegalArgumentException("Not a Home Centre server")
        }
        val url = base.toString()
        settingsStore.setServerUrl(url)
        val prev = _session.value
        _session.value = if (prev.serverUrl == url) prev else ServerSettings(serverUrl = url)
        return info
    }

    suspend fun login(username: String, password: String): User {
        val base = baseUrl ?: throw NotConfiguredException()
        val res = apiFor(base).login(LoginRequest(username.trim(), password))
        settingsStore.setSession(res.token, res.user)
        _session.value = _session.value.copy(token = res.token, user = res.user)
        return res.user
    }

    suspend fun logout() {
        settingsStore.clearSession()
        _session.value = _session.value.copy(token = null, user = null)
    }

    /** Runs an authenticated call; a 401 clears the session so the UI returns to login. */
    private suspend fun <T> authed(block: suspend HomeCentreApi.() -> T): T {
        try {
            return api().block()
        } catch (e: HttpException) {
            if (e.code() == 401) logout()
            throw e
        }
    }

    suspend fun libraries(): List<Library> = authed { libraries() }

    suspend fun media(
        kind: MediaKind? = null,
        libraryId: String? = null,
        folder: String? = null,
        query: String? = null,
        sort: String? = null,
        order: String? = null,
        offset: Int = 0,
        limit: Int = 50,
    ): Page<MediaItem> = authed {
        media(kind?.apiValue, libraryId, folder, query?.takeIf { it.isNotBlank() }, sort, order, offset, limit)
    }

    suspend fun recent(limit: Int = 20): List<MediaItem> = authed { recent(limit) }

    suspend fun continueWatching(): List<MediaItem> = authed { continueWatching() }

    suspend fun item(id: String): MediaItem = authed { item(id) }

    suspend fun folders(libraryId: String, path: String = ""): FolderListing = authed { folders(libraryId, path) }

    suspend fun series(): List<SeriesSummary> = authed { series() }

    suspend fun episodes(seriesName: String): List<MediaItem> = authed { episodes(seriesName) }

    suspend fun putProgress(id: String, positionSec: Double, completed: Boolean? = null): Progress =
        authed { putProgress(id, ProgressUpdate(positionSec, completed)) }

    /** Items of [kind] in the same folder as [item] (for audio queues / photo pagers). */
    suspend fun siblings(item: MediaItem, kind: MediaKind = item.kind): List<MediaItem> {
        val listing = runCatching { folders(item.libraryId, item.folder) }.getOrNull()
        val list = listing?.items?.filter { it.kind == kind }.orEmpty()
        return if (list.any { it.id == item.id }) list else listOf(item)
    }
}
