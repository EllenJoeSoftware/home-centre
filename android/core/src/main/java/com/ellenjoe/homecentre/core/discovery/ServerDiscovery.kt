package com.ellenjoe.homecentre.core.discovery

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.ProducerScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/**
 * Finds Home Centre servers on the local network (docs/API.md, "LAN discovery") by running a
 * UDP broadcast and an HTTP /24 scan at the same time. Results are emitted as soon as they are
 * found, de-duplicated by server id (falling back to URL); the flow completes after ~6 s and
 * is cancellable at any time.
 */
class ServerDiscovery(context: Context) {
    private val appContext = context.applicationContext

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(HTTP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .readTimeout(HTTP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .callTimeout(HTTP_TIMEOUT_MS * 2, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .dispatcher(Dispatcher().apply { maxRequests = MAX_IN_FLIGHT; maxRequestsPerHost = 2 })
            .build()
    }

    /** @param extraUrls additional base URLs to probe (e.g. the previously saved server). */
    fun discover(extraUrls: List<String> = emptyList()): Flow<DiscoveredServer> = channelFlow {
        val seen = ConcurrentHashMap.newKeySet<String>()
        val emit: suspend (DiscoveredServer) -> Unit = { s -> if (seen.add(s.key)) send(s) }
        val iface = localIpv4()
        withTimeoutOrNull(TOTAL_MS) {
            coroutineScope {
                launch { runCatching { udpBroadcast(iface, emit) }.onFailure { logFailure("UDP", it) } }
                launch { runCatching { httpScan(iface, extraUrls, emit) }.onFailure { logFailure("HTTP", it) } }
            }
        }
    }.flowOn(Dispatchers.IO)

    // ------------------------------------------------------------------ network info

    /** Device IPv4 address + prefix on the active (or any Wi-Fi/Ethernet) network. */
    internal data class LocalIpv4(val address: Int, val prefix: Int)

    @SuppressLint("MissingPermission")
    private fun localIpv4(): LocalIpv4? = runCatching {
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return null
        val candidates = buildList<LinkProperties> {
            cm.activeNetwork?.let { cm.getLinkProperties(it) }?.let(::add)
            @Suppress("DEPRECATION")
            cm.allNetworks.forEach { n ->
                val caps = cm.getNetworkCapabilities(n) ?: return@forEach
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                ) cm.getLinkProperties(n)?.let(::add)
            }
        }
        candidates.firstNotNullOfOrNull { lp ->
            lp.linkAddresses.firstOrNull { la ->
                val a = la.address
                a is Inet4Address && !a.isLoopbackAddress && !a.isLinkLocalAddress
            }?.let { LocalIpv4(DiscoveryNet.ipv4ToInt(it.address.address), it.prefixLength) }
        }
    }.getOrNull()

    // ------------------------------------------------------------------ UDP

    private suspend fun udpBroadcast(iface: LocalIpv4?, emit: suspend (DiscoveredServer) -> Unit) = coroutineScope {
        val targets = buildList {
            add(InetAddress.getByName("255.255.255.255"))
            iface?.let { DiscoveryNet.broadcastAddress(it.address, it.prefix) }
                ?.let { add(InetAddress.getByAddress(DiscoveryNet.intToBytes(it))) }
        }.distinct()
        val payload = DiscoveryNet.REQUEST.toByteArray(Charsets.US_ASCII)
        val lock = acquireMulticastLock()
        val socket = DatagramSocket().apply {
            broadcast = true
            soTimeout = RECEIVE_POLL_MS
        }
        try {
            val sender = launch {
                repeat(SEND_COUNT) { i ->
                    if (i > 0) delay(SEND_INTERVAL_MS)
                    for (t in targets) {
                        runCatching { socket.send(DatagramPacket(payload, payload.size, t, DiscoveryNet.UDP_PORT)) }
                            .onFailure { logFailure("UDP send to $t", it) }
                    }
                }
            }
            val deadline = System.currentTimeMillis() + UDP_LISTEN_MS
            val buf = ByteArray(4096)
            while (isActive && System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buf, buf.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                } catch (e: IOException) {
                    if (socket.isClosed) break else continue
                }
                val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                val source = packet.address?.hostAddress ?: continue
                DiscoveryNet.parseReply(text, source)?.let { emit(it) }
            }
            sender.cancel()
        } finally {
            socket.close()
            runCatching { lock?.release() }
        }
    }

    private fun acquireMulticastLock(): WifiManager.MulticastLock? = runCatching {
        val wifi = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return null
        wifi.createMulticastLock("homecentre-discovery").apply {
            setReferenceCounted(false)
            acquire()
        }
    }.getOrNull()

    // ------------------------------------------------------------------ HTTP scan

    private suspend fun httpScan(
        iface: LocalIpv4?,
        extraUrls: List<String>,
        emit: suspend (DiscoveredServer) -> Unit,
    ) = coroutineScope {
        val bases = LinkedHashSet<String>()
        extraUrls.mapNotNullTo(bases) { DiscoveryNet.normalizeUrl(it) }
        iface?.let { DiscoveryNet.scanHostStrings(it.address, it.prefix) }
            ?.forEach { bases.add("http://$it:${DiscoveryNet.HTTP_PORT}") }
        val semaphore = Semaphore(MAX_IN_FLIGHT)
        for (base in bases) {
            launch {
                semaphore.withPermit {
                    ensureActive()
                    probe(base)?.let { emit(it) }
                }
            }
        }
    }

    private suspend fun probe(base: String): DiscoveredServer? {
        val request = runCatching { Request.Builder().url("$base/api/server/info").get().build() }.getOrNull()
            ?: return null
        val body = http.newCall(request).awaitBody() ?: return null
        return DiscoveryNet.parseServerInfo(body, base)
    }

    private suspend fun Call.awaitBody(): String? = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resume(null)
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.use { r ->
                    if (!r.isSuccessful) null
                    else runCatching { r.body?.source()?.let { s -> s.request(MAX_BODY); s.buffer.readUtf8() } }.getOrNull()
                }
                if (cont.isActive) cont.resume(body)
            }
        })
    }

    private fun logFailure(what: String, t: Throwable) {
        if (t is kotlinx.coroutines.CancellationException) return
        Log.d(TAG, "$what discovery failed: ${t.message}")
    }

    companion object {
        private const val TAG = "ServerDiscovery"
        const val TOTAL_MS = 6_000L
        const val UDP_LISTEN_MS = 2_500L
        const val SEND_COUNT = 3
        const val SEND_INTERVAL_MS = 400L
        const val RECEIVE_POLL_MS = 200
        const val HTTP_TIMEOUT_MS = 800L
        const val MAX_IN_FLIGHT = 64
        private const val MAX_BODY = 16L * 1024
    }
}

/** UI-facing state of a discovery run. */
data class DiscoveryState(
    val scanning: Boolean = false,
    val servers: List<DiscoveredServer> = emptyList(),
    /** True once at least one scan has finished. */
    val completed: Boolean = false,
)

/**
 * Small holder shared by the phone and TV setup screens: runs one discovery at a time in
 * [scope] and exposes the accumulated results as a [StateFlow].
 */
class DiscoveryController(
    private val discovery: ServerDiscovery,
    private val scope: CoroutineScope,
    private val extraUrls: () -> List<String> = { emptyList() },
) {
    private val _state = MutableStateFlow(DiscoveryState())
    val state: StateFlow<DiscoveryState> = _state.asStateFlow()
    private var job: Job? = null
    private var generation = 0

    /** Starts (or restarts) a scan; previous results are cleared. Call from the main thread. */
    fun start() {
        job?.cancel()
        val gen = ++generation
        _state.value = DiscoveryState(scanning = true, completed = _state.value.completed)
        job = scope.launch {
            try {
                discovery.discover(extraUrls()).collect { s ->
                    if (gen != generation) return@collect
                    _state.update { st -> if (st.servers.any { it.key == s.key }) st else st.copy(servers = st.servers + s) }
                }
            } finally {
                if (gen == generation) _state.update { it.copy(scanning = false, completed = true) }
            }
        }
    }

    fun stop() {
        job?.cancel()
        generation++
        _state.update { it.copy(scanning = false) }
    }
}
