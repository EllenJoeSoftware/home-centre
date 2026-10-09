import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
#if canImport(Combine)
import Combine
#endif

/// A Home Centre server found on the local network.
struct DiscoveredServer: Identifiable, Hashable, Sendable {
    /// Server UUID from /api/server/info (falls back to the URL for servers without one).
    let id: String
    let name: String
    let url: URL
}

/// LAN discovery, iOS flavour: HTTP scan only (UDP broadcast needs Apple's multicast entitlement).
/// See docs/API.md "LAN discovery".
enum ServerScanner {
    static let httpPort = 8096
    static let maxConcurrentProbes = 64
    static let probeTimeout: TimeInterval = 0.8
    static let overallTimeout: TimeInterval = 6

    /// Streams every Home Centre server that answers, as soon as it answers. Not de-duplicated
    /// (the same server may come back via the saved URL and via its IP). Finishes after all
    /// probes complete or `overallTimeout`, whichever is first; cancelling the consuming task
    /// stops the scan.
    static func scan(savedURL: URL?, timeout: TimeInterval = overallTimeout) -> AsyncStream<DiscoveredServer> {
        AsyncStream { continuation in
            let work = Task {
                await run(savedURL: savedURL) { _ = continuation.yield($0) }
                continuation.finish()
            }
            let timer = Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                work.cancel()
                continuation.finish()
            }
            continuation.onTermination = { _ in
                work.cancel()
                timer.cancel()
            }
        }
    }

    /// Base URLs to probe: the saved server first, then every host in the LAN subnet.
    static func targets(savedURL: URL?) -> [URL] {
        var urls: [URL] = []
        if let savedURL { urls.append(savedURL) }
        if let iface = currentLANInterface() {
            for host in SubnetMath.scanHosts(address: iface.address, netmask: iface.netmask) {
                if let url = URL(string: "http://\(SubnetMath.format(host)):\(httpPort)") { urls.append(url) }
            }
        }
        return urls
    }

    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = probeTimeout
        config.timeoutIntervalForResource = 2 // whole seconds (corelibs truncates fractions)
        #if canImport(Darwin)
        config.waitsForConnectivity = false // fail fast (e.g. Local Network permission denied)
        #endif
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpMaximumConnectionsPerHost = 2
        return URLSession(configuration: config)
    }

    private static func run(savedURL: URL?, onFound: @escaping @Sendable (DiscoveredServer) -> Void) async {
        let targets = targets(savedURL: savedURL)
        guard !targets.isEmpty else { return }
        let session = makeSession()
        defer { session.invalidateAndCancel() }

        await withTaskGroup(of: DiscoveredServer?.self) { group in
            var next = 0
            // Sliding window: keep at most `maxConcurrentProbes` requests in flight.
            while next < targets.count && next < maxConcurrentProbes {
                let url = targets[next]
                group.addTask { await probe(url, session: session) }
                next += 1
            }
            while let result = await group.next() {
                if let result { onFound(result) }
                if Task.isCancelled {
                    group.cancelAll()
                    continue // drain the (now cancelled) children quickly
                }
                if next < targets.count {
                    let url = targets[next]
                    group.addTask { await probe(url, session: session) }
                    next += 1
                }
            }
        }
    }

    /// GET <base>/api/server/info; returns the server if it identifies as Home Centre.
    static func probe(_ base: URL, session: URLSession) async -> DiscoveredServer? {
        var s = base.absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s + "/api/server/info") else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: probeTimeout)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let info = try JSONDecoder().decode(ServerInfo.self, from: data)
            guard info.isHomeCentre else { return nil }
            guard let baseURL = URL(string: s) else { return nil }
            return DiscoveredServer(id: info.id ?? s, name: info.name, url: baseURL)
        } catch {
            // Timeouts, refusals, Local Network permission denied, non-JSON replies: not a server.
            return nil
        }
    }

    // MARK: - Interfaces

    /// The device's Wi-Fi/Ethernet IPv4 interface (en0 preferred), or nil when there is none
    /// (e.g. cellular only).
    static func currentLANInterface() -> IPv4Interface? {
        SubnetMath.preferredInterface(ipv4Interfaces())
    }

    /// All IPv4 interfaces that are up and not loopback.
    static func ipv4Interfaces() -> [IPv4Interface] {
        var result: [IPv4Interface] = []
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return [] }
        defer { freeifaddrs(head) }

        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            defer { cursor = entry.pointee.ifa_next }
            let flags = UInt32(entry.pointee.ifa_flags)
            guard flags & UInt32(IFF_UP) != 0, flags & UInt32(IFF_LOOPBACK) == 0,
                  let addr = entry.pointee.ifa_addr, let mask = entry.pointee.ifa_netmask,
                  Int32(addr.pointee.sa_family) == AF_INET else { continue }
            let address = ipv4(addr)
            let netmask = ipv4(mask)
            let name = String(cString: entry.pointee.ifa_name)
            result.append(IPv4Interface(name: name, address: address, netmask: netmask))
        }
        return result
    }

    /// Host-byte-order IPv4 address from a sockaddr known to be AF_INET.
    private static func ipv4(_ sa: UnsafeMutablePointer<sockaddr>) -> UInt32 {
        sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
    }
}

#if canImport(Combine)
/// Drives the "Servers on your network" list: publishes de-duplicated servers as they are found.
@MainActor
final class ServerDiscoveryModel: ObservableObject {
    @Published private(set) var servers: [DiscoveredServer] = []
    @Published private(set) var isScanning = false
    /// True once at least one scan has finished (drives the empty-state hint).
    @Published private(set) var hasCompletedScan = false

    private var scanTask: Task<Void, Never>?
    private var generation = 0

    func start(savedURL: URL?) {
        scanTask?.cancel()
        generation += 1
        let current = generation
        servers = []
        isScanning = true
        scanTask = Task { [weak self] in
            for await server in ServerScanner.scan(savedURL: savedURL) {
                guard let self, self.generation == current else { return }
                self.add(server)
            }
            guard let self, self.generation == current else { return }
            self.isScanning = false
            self.hasCompletedScan = true
            self.scanTask = nil
        }
    }

    func stop() {
        scanTask?.cancel()
        scanTask = nil
        generation += 1
        if isScanning {
            isScanning = false
            hasCompletedScan = true
        }
    }

    private func add(_ server: DiscoveredServer) {
        guard !servers.contains(where: { $0.id == server.id }) else { return }
        servers.append(server)
    }
}
#endif
