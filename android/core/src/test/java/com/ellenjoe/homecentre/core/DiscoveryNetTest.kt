package com.ellenjoe.homecentre.core

import com.ellenjoe.homecentre.core.api.HomeCentreJson
import com.ellenjoe.homecentre.core.discovery.DiscoveryNet
import com.ellenjoe.homecentre.core.model.ServerInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryNetTest {
    private fun ip(s: String) = DiscoveryNet.ipv4ToInt(s)!!

    @Test
    fun ipv4RoundTrip() {
        assertEquals("192.168.1.10", DiscoveryNet.intToIpv4(ip("192.168.1.10")))
        assertEquals("255.255.255.255", DiscoveryNet.intToIpv4(ip("255.255.255.255")))
        assertEquals(ip("10.0.0.1"), DiscoveryNet.ipv4ToInt(byteArrayOf(10, 0, 0, 1)))
        assertEquals(ip("192.168.1.10"), DiscoveryNet.ipv4ToInt(byteArrayOf(192.toByte(), 168.toByte(), 1, 10)))
        assertNull(DiscoveryNet.ipv4ToInt("256.1.1.1"))
        assertNull(DiscoveryNet.ipv4ToInt("1.2.3"))
        assertNull(DiscoveryNet.ipv4ToInt("a.b.c.d"))
    }

    @Test
    fun broadcastAddress() {
        assertEquals("192.168.1.255", DiscoveryNet.intToIpv4(DiscoveryNet.broadcastAddress(ip("192.168.1.10"), 24)!!))
        assertEquals("10.0.255.255", DiscoveryNet.intToIpv4(DiscoveryNet.broadcastAddress(ip("10.0.3.7"), 16)!!))
        assertEquals("172.16.0.127", DiscoveryNet.intToIpv4(DiscoveryNet.broadcastAddress(ip("172.16.0.5"), 25)!!))
        assertEquals("255.255.255.255", DiscoveryNet.intToIpv4(DiscoveryNet.broadcastAddress(ip("1.2.3.4"), 0)!!))
        assertNull(DiscoveryNet.broadcastAddress(ip("1.2.3.4"), 31))
        assertNull(DiscoveryNet.broadcastAddress(ip("1.2.3.4"), 32))
    }

    @Test
    fun scanHostsSlash24SkipsSelfNetworkAndBroadcast() {
        val hosts = DiscoveryNet.scanHostStrings(ip("192.168.1.10"), 24)
        assertEquals(253, hosts.size)
        assertEquals("192.168.1.1", hosts.first())
        assertEquals("192.168.1.254", hosts.last())
        assertFalse("192.168.1.10" in hosts)
        assertFalse("192.168.1.0" in hosts)
        assertFalse("192.168.1.255" in hosts)
    }

    @Test
    fun scanHostsClampsShortPrefixTo24() {
        val hosts = DiscoveryNet.scanHostStrings(ip("10.0.3.7"), 16)
        assertEquals(253, hosts.size)
        assertTrue(hosts.all { it.startsWith("10.0.3.") })
        assertFalse("10.0.3.7" in hosts)
        assertEquals(253, DiscoveryNet.scanHosts(ip("10.200.5.1"), 8).size)
    }

    @Test
    fun scanHostsLongerPrefixes() {
        val h25 = DiscoveryNet.scanHostStrings(ip("192.168.1.200"), 25)
        assertEquals(125, h25.size)
        assertEquals("192.168.1.129", h25.first())
        assertEquals("192.168.1.254", h25.last())
        assertEquals(listOf("192.168.1.2"), DiscoveryNet.scanHostStrings(ip("192.168.1.1"), 30))
        assertEquals(listOf("192.168.1.1"), DiscoveryNet.scanHostStrings(ip("192.168.1.0"), 31))
        assertTrue(DiscoveryNet.scanHosts(ip("192.168.1.1"), 32).isEmpty())
    }

    @Test
    fun replyWithoutUrlUsesSourceIpAndPort() {
        val s = DiscoveryNet.parseReply(
            """{"product":"home-centre","id":"abc","name":"Den","version":"1.0.0","port":9000,"url":null}""",
            "192.168.1.20",
        )!!
        assertEquals("abc", s.id)
        assertEquals("Den", s.name)
        assertEquals("http://192.168.1.20:9000", s.url)
        assertEquals("1.0.0", s.version)
        assertEquals("abc", s.key)
    }

    @Test
    fun replyWithUrlPrefersPublicUrl() {
        val s = DiscoveryNet.parseReply(
            """{"product":"home-centre","id":"abc","name":"Den","version":"1.0.0","port":8096,"url":"http://media.lan:8096/"}""",
            "172.17.0.2",
        )!!
        assertEquals("http://media.lan:8096", s.url)
    }

    @Test
    fun replyDefaultsPortAndName() {
        val s = DiscoveryNet.parseReply("""{"product":"home-centre"}""", "10.0.0.5")!!
        assertEquals("http://10.0.0.5:8096", s.url)
        assertEquals("Home Centre", s.name)
        assertNull(s.id)
        assertEquals("http://10.0.0.5:8096", s.key)
    }

    @Test
    fun replyRejectsOtherProductsAndGarbage() {
        assertNull(DiscoveryNet.parseReply("""{"product":"jellyfin","port":8096}""", "10.0.0.5"))
        assertNull(DiscoveryNet.parseReply("""{"port":8096}""", "10.0.0.5"))
        assertNull(DiscoveryNet.parseReply("HOMECENTRE_DISCOVER", "10.0.0.5"))
        assertNull(DiscoveryNet.parseReply("", "10.0.0.5"))
    }

    @Test
    fun serverInfoParsing() {
        val s = DiscoveryNet.parseServerInfo(
            """{"product":"home-centre","id":"u-1","name":"Lounge","version":"1.2.0"}""",
            "http://192.168.1.30:8096",
        )!!
        assertEquals("u-1", s.id)
        assertEquals("Lounge", s.name)
        assertEquals("http://192.168.1.30:8096", s.url)
        // Older servers without `product` are not accepted by discovery.
        assertNull(DiscoveryNet.parseServerInfo("""{"name":"Home Centre","version":"0.9"}""", "http://1.2.3.4:8096"))
        assertNull(DiscoveryNet.parseServerInfo("<html></html>", "http://1.2.3.4:8096"))
    }

    @Test
    fun serverInfoModelStillParsesOlderServers() {
        val old = HomeCentreJson.decodeFromString(ServerInfo.serializer(), """{"name":"Home Centre","version":"0.9.0"}""")
        assertNull(old.product)
        assertNull(old.id)
        val new = HomeCentreJson.decodeFromString(
            ServerInfo.serializer(),
            """{"product":"home-centre","id":"x","name":"N","version":"1.0.0"}""",
        )
        assertEquals(ServerInfo.PRODUCT, new.product)
        assertEquals("x", new.id)
    }
}
