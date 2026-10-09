import SwiftUI

struct ServerSetupView: View {
    @EnvironmentObject private var appState: AppState
    @State private var address: String = ServerSettings.serverURL?.absoluteString ?? ""
    @State private var isConnecting = false
    @State private var error: String? = nil
    /// URL of the discovered server currently being connected to (shows a spinner on its row).
    @State private var connectingServerURL: URL? = nil
    @StateObject private var discovery = ServerDiscoveryModel()

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    Image(systemName: "play.rectangle.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(Theme.accent)
                    Text("Home Centre")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                    Text("Choose a server on your network, or enter its address.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 60)

                discoveredServersSection

                VStack(alignment: .leading, spacing: 8) {
                    Text("Server URL").font(.caption).foregroundStyle(Theme.secondaryText)
                    TextField("http://192.168.1.10:8096", text: $address)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit(connect)
                        .padding(14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(.white)
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: connect) {
                    HStack {
                        if isConnecting { ProgressView().tint(.black) }
                        Text(isConnecting ? "Connecting…" : "Connect").bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isConnecting || address.trimmingCharacters(in: .whitespaces).isEmpty)

                Text("Your phone must be on the same network as the server (or able to reach it). The first connection may ask for Local Network permission.")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
        .onAppear(perform: startDiscovery)
        .onDisappear { discovery.stop() }
    }

    // MARK: - Servers on your network

    private var discoveredServersSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Servers on your network")
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                if discovery.isScanning {
                    ProgressView()
                        .controlSize(.small)
                        .tint(Theme.secondaryText)
                }
                Spacer()
                Button("Search again", action: startDiscovery)
                    .font(.caption.bold())
                    .disabled(discovery.isScanning || isConnecting)
            }

            if discovery.servers.isEmpty {
                Text(discovery.isScanning
                     ? "Searching…"
                     : "No servers found. Make sure your iPhone and the server are on the same Wi-Fi network, and that Home Centre is allowed to use the Local Network (Settings › Privacy & Security › Local Network).")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            } else {
                VStack(spacing: 0) {
                    ForEach(discovery.servers) { server in
                        if server.id != discovery.servers.first?.id {
                            Divider().padding(.leading, 52)
                        }
                        serverRow(server)
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func serverRow(_ server: DiscoveredServer) -> some View {
        Button {
            address = server.url.absoluteString
            performConnect(server.url.absoluteString, discovered: server.url)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "server.rack")
                    .font(.title3)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(server.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(server.url.absoluteString)
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                if connectingServerURL == server.url {
                    ProgressView().tint(Theme.secondaryText)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isConnecting)
        .accessibilityLabel("\(server.name), \(server.url.absoluteString)")
        .accessibilityHint("Connects to this server")
    }

    private func startDiscovery() {
        // The first scan triggers iOS's Local Network permission prompt; if it is denied the
        // probes simply fail and the scan ends empty (capped at ~6 s), showing the hint above.
        discovery.start(savedURL: ServerSettings.lastServerURL ?? ServerSettings.serverURL)
    }

    // MARK: - Connect

    private func connect() {
        performConnect(address, discovered: nil)
    }

    private func performConnect(_ rawURL: String, discovered: URL?) {
        guard !isConnecting else { return }
        error = nil
        isConnecting = true
        connectingServerURL = discovered
        Task {
            defer {
                isConnecting = false
                connectingServerURL = nil
            }
            do {
                try await appState.connect(to: rawURL)
            } catch {
                self.error = appState.handle(error)
            }
        }
    }
}
