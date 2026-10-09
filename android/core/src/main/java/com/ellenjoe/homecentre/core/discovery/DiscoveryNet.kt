package com.ellenjoe.homecentre.core.discovery

import com.ellenjoe.homecentre.core.api.ApiClient
import com.ellenjoe.homecentre.core.api.HomeCentreJson
import com.ellenjoe.homecentre.core.model.ServerInfo
import kotlinx.serialization.Serializable

/** A Home Centre server found on the LAN. [url] has no trailing slash, e.g. `http://192.168.1.10:8096`. */
data class DiscoveredServer(
    val id: String?,
    val name: String,
    val url: String,
    val version: String,
) {
    /** De-duplication key: the server's stable id, or its URL for servers that do not report one. */
    val key: String get() = id?.takeIf { it.isNotBlank() } ?: url
}

/** UDP reply body (see docs/API.md, "LAN discovery"). */
@Serializable
internal data class DiscoveryReply(
    val product: String? = null,
    val id: String? = null,
    val name: String? = null,
    val version: String? = null,
    val port: Int? = null,
    val url: String? = null,
)

/**
 * Pure, Android-free helpers for LAN discovery. IPv4 addresses are handled as big-endian
 * `Int`s (`192.168.1.10` → `0xC0A8010A`).
 */
object DiscoveryNet {
    const val UDP_PORT = 7359
    const val HTTP_PORT = 8096
    const val REQUEST = "HOMECENTRE_DISCOVER"

    /** Prefixes shorter than this are clamped: only the /24 containing the device is scanned. */
    const val MIN_SCAN_PREFIX = 24

    fun ipv4ToInt(bytes: ByteArray): Int {
        require(bytes.size == 4) { "Not an IPv4 address" }
        return (bytes[0].toInt() and 0xFF shl 24) or
            (bytes[1].toInt() and 0xFF shl 16) or
            (bytes[2].toInt() and 0xFF shl 8) or
            (bytes[3].toInt() and 0xFF)
    }

    fun ipv4ToInt(dotted: String): Int? {
        val parts = dotted.trim().split('.')
        if (parts.size != 4) return null
        val nums = parts.map { p -> p.toIntOrNull()?.takeIf { p.isNotEmpty() && it in 0..255 } ?: return null }
        return (nums[0] shl 24) or (nums[1] shl 16) or (nums[2] shl 8) or nums[3]
    }

    fun intToIpv4(ip: Int): String =
        "${ip ushr 24 and 0xFF}.${ip ushr 16 and 0xFF}.${ip ushr 8 and 0xFF}.${ip and 0xFF}"

    fun intToBytes(ip: Int): ByteArray =
        byteArrayOf((ip ushr 24).toByte(), (ip ushr 16).toByte(), (ip ushr 8).toByte(), ip.toByte())

    /** Netmask for a prefix length (0..32). */
    fun netmask(prefix: Int): Int {
        require(prefix in 0..32) { "Invalid prefix $prefix" }
        return if (prefix == 0) 0 else (-1 shl (32 - prefix))
    }

    /** Directed broadcast address of the subnet, or null for /31 and /32 (no broadcast). */
    fun broadcastAddress(ip: Int, prefix: Int): Int? {
        if (prefix !in 0..30) return null
        return (ip and netmask(prefix)) or netmask(prefix).inv()
    }

    /**
     * Host addresses to probe for [ip]/[prefix]: every usable host in the subnet (network and
     * broadcast addresses excluded), with prefixes shorter than /24 clamped to the /24 containing
     * the device, and the device's own address skipped. /31 and /32 yield the peer (if any) only.
     */
    fun scanHosts(ip: Int, prefix: Int): List<Int> {
        require(prefix in 0..32) { "Invalid prefix $prefix" }
        val p = maxOf(prefix, MIN_SCAN_PREFIX)
        val mask = netmask(p)
        val network = ip and mask
        val size = 1L shl (32 - p)
        val range = if (p >= 31) (0 until size) else (1 until size - 1)
        return range.map { (network + it.toInt()) }.filter { it != ip }
    }

    /** [scanHosts] as dotted strings. */
    fun scanHostStrings(ip: Int, prefix: Int): List<String> = scanHosts(ip, prefix).map(::intToIpv4)

    /** Normalises a base URL for display/de-duplication: `http://host:port` (no trailing slash). */
    fun normalizeUrl(input: String): String? =
        ApiClient.normalizeServerUrl(input)?.toString()?.trimEnd('/')

    /**
     * Parses a UDP discovery reply received from [sourceIp]. Returns null unless it is a valid
     * Home Centre reply. URL = `url` if present, else `http://<sourceIp>:<port>`.
     */
    fun parseReply(payload: String, sourceIp: String): DiscoveredServer? {
        val reply = runCatching { HomeCentreJson.decodeFromString(DiscoveryReply.serializer(), payload) }
            .getOrNull() ?: return null
        if (reply.product != ServerInfo.PRODUCT) return null
        val url = reply.url?.takeIf { it.isNotBlank() }?.let(::normalizeUrl)
            ?: run {
                val port = reply.port?.takeIf { it in 1..65535 } ?: HTTP_PORT
                val host = if (sourceIp.contains(':')) "[$sourceIp]" else sourceIp
                normalizeUrl("http://$host:$port")
            }
            ?: return null
        return DiscoveredServer(
            id = reply.id?.takeIf { it.isNotBlank() },
            name = reply.name?.takeIf { it.isNotBlank() } ?: "Home Centre",
            url = url,
            version = reply.version.orEmpty(),
        )
    }

    /** Parses a `/api/server/info` body fetched from [baseUrl]; null unless `product == "home-centre"`. */
    fun parseServerInfo(body: String, baseUrl: String): DiscoveredServer? {
        val info = runCatching { HomeCentreJson.decodeFromString(ServerInfo.serializer(), body) }
            .getOrNull() ?: return null
        if (info.product != ServerInfo.PRODUCT) return null
        val url = normalizeUrl(baseUrl) ?: return null
        return DiscoveredServer(
            id = info.id?.takeIf { it.isNotBlank() },
            name = info.name.ifBlank { "Home Centre" },
            url = url,
            version = info.version,
        )
    }
}
