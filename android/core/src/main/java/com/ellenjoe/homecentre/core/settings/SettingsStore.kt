package com.ellenjoe.homecentre.core.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ellenjoe.homecentre.core.api.HomeCentreJson
import com.ellenjoe.homecentre.core.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

data class ServerSettings(
    val serverUrl: String? = null,
    val token: String? = null,
    val user: User? = null,
) {
    val isLoggedIn: Boolean get() = !serverUrl.isNullOrBlank() && !token.isNullOrBlank()
}

private val Context.homeCentreDataStore: DataStore<Preferences> by preferencesDataStore(name = "home_centre")

class SettingsStore(context: Context) {
    private val dataStore = context.applicationContext.homeCentreDataStore

    private object Keys {
        val serverUrl = stringPreferencesKey("server_url")
        val token = stringPreferencesKey("token")
        val user = stringPreferencesKey("user")
    }

    val settings: Flow<ServerSettings> = dataStore.data.map { prefs ->
        ServerSettings(
            serverUrl = prefs[Keys.serverUrl],
            token = prefs[Keys.token],
            user = prefs[Keys.user]?.let {
                runCatching { HomeCentreJson.decodeFromString(User.serializer(), it) }.getOrNull()
            },
        )
    }

    suspend fun snapshot(): ServerSettings = settings.first()

    suspend fun setServerUrl(url: String) {
        dataStore.edit {
            if (it[Keys.serverUrl] != url) {
                it.remove(Keys.token)
                it.remove(Keys.user)
            }
            it[Keys.serverUrl] = url
        }
    }

    suspend fun setSession(token: String, user: User) {
        dataStore.edit {
            it[Keys.token] = token
            it[Keys.user] = HomeCentreJson.encodeToString(User.serializer(), user)
        }
    }

    suspend fun clearSession() {
        dataStore.edit {
            it.remove(Keys.token)
            it.remove(Keys.user)
        }
    }
}
