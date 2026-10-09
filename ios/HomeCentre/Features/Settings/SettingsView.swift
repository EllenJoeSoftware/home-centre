import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @State private var scanStatus: ScanStatus? = nil
    @State private var message: String? = nil
    @State private var confirmLogout = false

    private var appVersion: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(v) (\(b))"
    }

    var body: some View {
        List {
            Section("Server") {
                LabeledContent("Name", value: appState.serverName)
                LabeledContent("Address", value: appState.serverURL?.absoluteString ?? "—")
                if let scanStatus {
                    LabeledContent("Items", value: "\(scanStatus.itemCount)")
                    LabeledContent("Last scan", value: scanStatus.lastScanAt.map(Format.date) ?? "Never")
                    if scanStatus.running {
                        HStack { ProgressView(); Text("Scanning…").foregroundStyle(Theme.secondaryText) }
                    }
                }
                if appState.user?.isAdmin == true {
                    Button("Scan libraries now") { startScan() }
                        .disabled(scanStatus?.running == true)
                }
                if let message {
                    Text(message).font(.footnote).foregroundStyle(Theme.secondaryText)
                }
            }
            .listRowBackground(Theme.surface)

            Section("Account") {
                LabeledContent("Signed in as", value: appState.user?.username ?? "—")
                if appState.user?.isAdmin == true {
                    LabeledContent("Role", value: "Administrator")
                }
                Button("Sign out", role: .destructive) { confirmLogout = true }
                Button("Change server") { appState.changeServer() }
            }
            .listRowBackground(Theme.surface)

            Section("About") {
                LabeledContent("Home Centre for iPhone", value: appVersion)
            }
            .listRowBackground(Theme.surface)
        }
        .listStyle(.insetGrouped)
        .screenBackground()
        .navigationTitle("Settings")
        .task { await loadStatus() }
        .refreshable { await loadStatus() }
        .confirmationDialog("Sign out of \(appState.serverName)?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { appState.logout() }
        }
    }

    private func loadStatus() async {
        guard let api = appState.api else { return }
        do {
            scanStatus = try await api.scanStatus()
        } catch {
            message = appState.handle(error)
        }
    }

    private func startScan() {
        guard let api = appState.api else { return }
        Task {
            do {
                _ = try await api.startScan()
                message = "Scan started."
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await loadStatus()
            } catch {
                message = appState.handle(error)
            }
        }
    }
}
