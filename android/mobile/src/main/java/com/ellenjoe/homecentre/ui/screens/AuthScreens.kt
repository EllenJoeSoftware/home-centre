package com.ellenjoe.homecentre.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ellenjoe.homecentre.core.HomeCentre
import com.ellenjoe.homecentre.core.data.userMessage
import com.ellenjoe.homecentre.core.discovery.DiscoveredServer
import com.ellenjoe.homecentre.core.discovery.DiscoveryController
import com.ellenjoe.homecentre.core.discovery.DiscoveryState
import com.ellenjoe.homecentre.ui.common.rememberRepository
import kotlinx.coroutines.launch

@Composable
private fun AuthScaffold(title: String, subtitle: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(48.dp))
        Icon(Icons.Filled.Home, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp))
        Spacer(Modifier.height(12.dp))
        Text(title, style = MaterialTheme.typography.headlineMedium)
        Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 24.dp))
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth()) { content() }
    }
}

@Composable
fun SetupScreen(onConnected: () -> Unit) {
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    var url by rememberSaveable { mutableStateOf(repo.session.value.serverUrl ?: "http://") }
    var busy by rememberSaveable { mutableStateOf(false) }
    /** URL of the discovered server currently being validated (shows a spinner on its card). */
    var connectingTo by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    val discovery = rememberDiscoveryController()
    val found by discovery.state.collectAsState()

    fun connect(target: String = url, fromDiscovery: Boolean = false) {
        if (busy) return
        busy = true; error = null
        connectingTo = if (fromDiscovery) target else null
        scope.launch {
            try {
                repo.connect(target)
                discovery.stop()
                onConnected()
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                busy = false
                connectingTo = null
            }
        }
    }

    AuthScaffold("Home Centre", "Connect to your server") {
        DiscoveredServersSection(
            state = found,
            enabled = !busy,
            connectingTo = connectingTo,
            onPick = { connect(it.url, fromDiscovery = true) },
            onSearchAgain = discovery::start,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            "Or enter the address manually",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Server address") },
            placeholder = { Text("http://192.168.1.10:8096") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { connect() }),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = { connect() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy && connectingTo == null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Connect")
        }
    }
}

/** Starts a LAN scan when the screen opens; stops it when the screen leaves composition. */
@Composable
private fun rememberDiscoveryController(): DiscoveryController {
    val context = LocalContext.current
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    val controller = remember {
        DiscoveryController(HomeCentre.discovery(context), scope) { listOfNotNull(repo.session.value.serverUrl) }
    }
    DisposableEffect(controller) {
        controller.start()
        onDispose { controller.stop() }
    }
    return controller
}

@Composable
private fun DiscoveredServersSection(
    state: DiscoveryState,
    enabled: Boolean,
    connectingTo: String?,
    onPick: (DiscoveredServer) -> Unit,
    onSearchAgain: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Text("Servers on your network", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        if (state.scanning) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        } else {
            TextButton(onClick = onSearchAgain, enabled = enabled) {
                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Search again")
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        state.servers.forEach { server ->
            key(server.key) {
                OutlinedCard(
                    onClick = { onPick(server) },
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Dns, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f)) {
                            Text(server.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                server.url,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (connectingTo == server.url) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    }
                }
            }
        }
        when {
            state.servers.isEmpty() && state.scanning ->
                Text("Searching…", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            state.servers.isEmpty() ->
                Text(
                    "No servers found. Make sure the phone and the server are on the same Wi-Fi network.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
        }
    }
}

@Composable
fun LoginScreen(onLoggedIn: () -> Unit, onChangeServer: () -> Unit) {
    val repo = rememberRepository()
    val scope = rememberCoroutineScope()
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    fun login() {
        if (busy || username.isBlank()) return
        busy = true; error = null
        scope.launch {
            try {
                repo.login(username, password)
                onLoggedIn()
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    AuthScaffold("Sign in", repo.session.value.serverUrl.orEmpty()) {
        OutlinedTextField(
            value = username, onValueChange = { username = it },
            label = { Text("Username") }, singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it },
            label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { login() }),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = ::login, enabled = !busy && username.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Sign in")
        }
        TextButton(onClick = onChangeServer, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Change server") }
    }
}
