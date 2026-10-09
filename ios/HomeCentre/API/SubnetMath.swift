import Foundation

/// An IPv4 interface as reported by getifaddrs. Addresses are host byte order.
struct IPv4Interface: Equatable, Sendable {
    let name: String
    let address: UInt32
    let netmask: UInt32
}

/// Pure IPv4 subnet helpers for LAN discovery (no networking, no UIKit — unit-testable).
/// All addresses are UInt32 in host byte order, e.g. 192.168.1.10 == 0xC0A8010A.
enum SubnetMath {
    /// Subnets with a shorter prefix than this are clamped to the /24 containing the device.
    static let minimumScanPrefix = 24

    /// Interface name prefixes that are never the Wi-Fi/Ethernet LAN
    /// (cellular, VPN tunnels, AirDrop/Wi-Fi Aware, loopback).
    static let excludedInterfacePrefixes = ["pdp_ip", "utun", "ipsec", "awdl", "llw", "lo"]

    // MARK: - Formatting

    static func parse(_ string: String) -> UInt32? {
        let parts = string.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var value: UInt32 = 0
        for part in parts {
            guard !part.isEmpty, part.count <= 3, part.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let octet = UInt32(part), octet <= 255 else { return nil }
            value = (value << 8) | octet
        }
        return value
    }

    static func format(_ address: UInt32) -> String {
        "\(address >> 24 & 0xFF).\(address >> 16 & 0xFF).\(address >> 8 & 0xFF).\(address & 0xFF)"
    }

    // MARK: - Masks

    /// Number of leading one bits in the netmask (255.255.255.0 → 24).
    static func prefixLength(ofNetmask netmask: UInt32) -> Int {
        (~netmask).leadingZeroBitCount
    }

    static func netmask(prefixLength: Int) -> UInt32 {
        let p = min(max(prefixLength, 0), 32)
        return p == 0 ? 0 : UInt32.max << UInt32(32 - p)
    }

    // MARK: - Host enumeration

    /// Host addresses to probe for the given device address/netmask: every host in the subnet
    /// (clamped to the device's /24 when the prefix is shorter than /24), excluding the network
    /// address, the broadcast address and the device's own address.
    static func scanHosts(address: UInt32, netmask: UInt32) -> [UInt32] {
        let prefix = max(prefixLength(ofNetmask: netmask), minimumScanPrefix)
        switch prefix {
        case 32:
            return []
        case 31:
            // RFC 3021 point-to-point: both addresses are hosts.
            let other = address ^ 1
            return [other]
        default:
            let mask = self.netmask(prefixLength: prefix)
            let network = address & mask
            let broadcast = network | ~mask
            var hosts: [UInt32] = []
            hosts.reserveCapacity(Int(broadcast - network))
            var host = network + 1
            while host < broadcast {
                if host != address { hosts.append(host) }
                host += 1
            }
            return hosts
        }
    }

    // MARK: - Interface choice

    static func isLoopback(_ address: UInt32) -> Bool { address >> 24 == 127 }
    static func isLinkLocal(_ address: UInt32) -> Bool { address >> 16 == 0xA9FE } // 169.254/16

    static func isCandidateLANInterface(_ iface: IPv4Interface) -> Bool {
        guard iface.address != 0, !isLoopback(iface.address), !isLinkLocal(iface.address) else { return false }
        return !excludedInterfacePrefixes.contains { iface.name.hasPrefix($0) }
    }

    /// Picks the Wi-Fi/Ethernet interface to scan: en0 if it qualifies, otherwise the first
    /// qualifying interface. Callers should pass only interfaces that are up and not loopback.
    static func preferredInterface(_ interfaces: [IPv4Interface]) -> IPv4Interface? {
        let candidates = interfaces.filter(isCandidateLANInterface)
        return candidates.first { $0.name == "en0" } ?? candidates.first
    }
}
