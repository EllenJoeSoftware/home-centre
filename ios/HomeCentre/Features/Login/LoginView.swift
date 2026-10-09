import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appState: AppState
    @State private var username = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var error: String? = nil

    private enum Field { case username, password }
    @FocusState private var focus: Field?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(Theme.accent)
                    Text("Sign in")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                    if let url = appState.serverURL {
                        Text(url.absoluteString)
                            .font(.footnote.monospaced())
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                .padding(.top, 60)

                VStack(spacing: 12) {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .padding(14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(login)
                        .padding(14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                }
                .foregroundStyle(.white)

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: login) {
                    HStack {
                        if isLoading { ProgressView().tint(.black) }
                        Text("Sign in").bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isLoading || username.isEmpty || password.isEmpty)

                Button("Change server") { appState.changeServer() }
                    .font(.footnote)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
        .onAppear { focus = .username }
    }

    private func login() {
        guard !isLoading, !username.isEmpty, !password.isEmpty else { return }
        error = nil
        isLoading = true
        Task {
            defer { isLoading = false }
            do {
                try await appState.login(username: username, password: password)
            } catch APIError.unauthorized {
                self.error = "Incorrect username or password."
            } catch {
                self.error = appState.handle(error)
            }
        }
    }
}
