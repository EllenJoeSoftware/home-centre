import XCTest
@testable import HomeCentre

final class SubnetMathTests: XCTestCase {
    private func ip(_ s: String) -> UInt32 { SubnetMath.parse(s)! }

    func testParseAndFormat() {
        XCTAssertEqual(SubnetMath.parse("192.168.1.10"), 0xC0A8_010A)
        XCTAssertEqual(SubnetMath.format(0xC0A8_010A), "192.168.1.10")
        XCTAssertEqual(SubnetMath.parse("0.0.0.0"), 0)
        XCTAssertEqual(SubnetMath.parse("255.255.255.255"), UInt32.max)
        XCTAssertNil(SubnetMath.parse("256.1.1.1"))
        XCTAssertNil(SubnetMath.parse("1.2.3"))
        XCTAssertNil(SubnetMath.parse("1.2.3.4.5"))
        XCTAssertNil(SubnetMath.parse("1..3.4"))
        XCTAssertNil(SubnetMath.parse("a.b.c.d"))
    }

    func testPrefixLengthAndMask() {
        XCTAssertEqual(SubnetMath.prefixLength(ofNetmask: ip("255.255.255.0")), 24)
        XCTAssertEqual(SubnetMath.prefixLength(ofNetmask: ip("255.255.0.0")), 16)
        XCTAssertEqual(SubnetMath.prefixLength(ofNetmask: ip("255.255.255.255")), 32)
        XCTAssertEqual(SubnetMath.prefixLength(ofNetmask: 0), 0)
        XCTAssertEqual(SubnetMath.netmask(prefixLength: 24), ip("255.255.255.0"))
        XCTAssertEqual(SubnetMath.netmask(prefixLength: 28), ip("255.255.255.240"))
        XCTAssertEqual(SubnetMath.netmask(prefixLength: 0), 0)
        XCTAssertEqual(SubnetMath.netmask(prefixLength: 32), UInt32.max)
    }

    func testSlash24SkipsNetworkBroadcastAndSelf() {
        let hosts = SubnetMath.scanHosts(address: ip("192.168.1.10"), netmask: ip("255.255.255.0"))
        XCTAssertEqual(hosts.count, 253)
        XCTAssertEqual(hosts.first, ip("192.168.1.1"))
        XCTAssertEqual(hosts.last, ip("192.168.1.254"))
        XCTAssertFalse(hosts.contains(ip("192.168.1.0")))
        XCTAssertFalse(hosts.contains(ip("192.168.1.255")))
        XCTAssertFalse(hosts.contains(ip("192.168.1.10")))
    }

    func testShorterPrefixIsClampedToDeviceSlash24() {
        let hosts = SubnetMath.scanHosts(address: ip("10.0.5.77"), netmask: ip("255.255.0.0"))
        XCTAssertEqual(hosts.count, 253)
        XCTAssertEqual(hosts.first, ip("10.0.5.1"))
        XCTAssertEqual(hosts.last, ip("10.0.5.254"))
        XCTAssertFalse(hosts.contains(ip("10.0.5.77")))

        let zeroMask = SubnetMath.scanHosts(address: ip("172.16.3.4"), netmask: 0)
        XCTAssertEqual(zeroMask.count, 253)
        XCTAssertEqual(zeroMask.first, ip("172.16.3.1"))
    }

    func testLongerPrefix() {
        let hosts = SubnetMath.scanHosts(address: ip("192.168.1.18"), netmask: ip("255.255.255.240"))
        // 192.168.1.16/28: hosts .17 – .30, minus self.
        XCTAssertEqual(hosts.map(SubnetMath.format),
                       (17...30).filter { $0 != 18 }.map { "192.168.1.\($0)" })
    }

    func testPointToPointAndSingleHost() {
        XCTAssertEqual(SubnetMath.scanHosts(address: ip("10.0.0.4"), netmask: ip("255.255.255.254")), [ip("10.0.0.5")])
        XCTAssertEqual(SubnetMath.scanHosts(address: ip("10.0.0.5"), netmask: ip("255.255.255.254")), [ip("10.0.0.4")])
        XCTAssertEqual(SubnetMath.scanHosts(address: ip("10.0.0.5"), netmask: UInt32.max), [])
    }

    func testPreferredInterfacePrefersEn0() {
        let ifaces = [
            IPv4Interface(name: "pdp_ip0", address: ip("100.64.1.2"), netmask: ip("255.255.255.255")),
            IPv4Interface(name: "en2", address: ip("192.168.50.3"), netmask: ip("255.255.255.0")),
            IPv4Interface(name: "en0", address: ip("192.168.1.10"), netmask: ip("255.255.255.0")),
        ]
        XCTAssertEqual(SubnetMath.preferredInterface(ifaces)?.name, "en0")
    }

    func testPreferredInterfaceSkipsCellularVPNAndLinkLocal() {
        let ifaces = [
            IPv4Interface(name: "pdp_ip0", address: ip("100.64.1.2"), netmask: ip("255.255.255.255")),
            IPv4Interface(name: "utun3", address: ip("10.8.0.2"), netmask: ip("255.255.255.0")),
            IPv4Interface(name: "en0", address: ip("169.254.3.4"), netmask: ip("255.255.0.0")),
            IPv4Interface(name: "lo0", address: ip("127.0.0.1"), netmask: ip("255.0.0.0")),
            IPv4Interface(name: "bridge100", address: ip("172.20.10.1"), netmask: ip("255.255.255.240")),
        ]
        XCTAssertEqual(SubnetMath.preferredInterface(ifaces)?.name, "bridge100")
        XCTAssertNil(SubnetMath.preferredInterface(Array(ifaces.prefix(4))))
        XCTAssertNil(SubnetMath.preferredInterface([]))
    }

    func testServerInfoDecodesProductAndId() throws {
        let json = #"{"product":"home-centre","id":"0b7c","name":"Den","version":"1.0.0"}"#
        let info = try JSONDecoder().decode(ServerInfo.self, from: Data(json.utf8))
        XCTAssertTrue(info.isHomeCentre)
        XCTAssertEqual(info.id, "0b7c")
        let legacy = try JSONDecoder().decode(ServerInfo.self, from: Data(#"{"name":"Old","version":"0.9"}"#.utf8))
        XCTAssertFalse(legacy.isHomeCentre)
        XCTAssertNil(legacy.id)
    }
}
