import SwiftUI

struct ServerSetupView: View {
    @EnvironmentObject private var appState: AppState
    @State private var address: String = ServerSettings.serverURL?.absoluteString ?? ""
    @State private var isConnecting = false
    @State private var error: String? = nil

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
                    Text("Enter the address of your Home Centre server.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 60)

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
    }

    private func connect() {
        guard !isConnecting else { return }
        error = nil
        isConnecting = true
        Task {
            defer { isConnecting = false }
            do {
                try await appState.connect(to: address)
            } catch {
                self.error = appState.handle(error)
            }
        }
    }
}
