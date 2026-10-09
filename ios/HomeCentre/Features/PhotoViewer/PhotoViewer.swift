import SwiftUI

/// Full-screen swipeable photo viewer (TabView paging + AsyncImage, pinch / double-tap to zoom).
struct PhotoViewer: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let items: [MediaItem]
    @State private var selection: String
    @State private var chromeVisible = true

    init(items: [MediaItem], startId: String) {
        self.items = items
        _selection = State(initialValue: startId)
    }

    private var currentIndex: Int { items.firstIndex { $0.id == selection } ?? 0 }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(items) { item in
                    ZoomablePhoto(url: appState.urls?.streamURL(item.id))
                        .tag(item.id)
                        .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { chromeVisible.toggle() } }
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            if chromeVisible {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .frame(width: 36, height: 36)
                            .background(Color.black.opacity(0.5), in: Circle())
                    }
                    .accessibilityLabel("Close")
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(items.indices.contains(currentIndex) ? items[currentIndex].title : "")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text("\(currentIndex + 1) of \(items.count)")
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .transition(.opacity)
            }
        }
        .statusBarHidden(!chromeVisible)
    }
}

private struct ZoomablePhoto: View {
    let url: URL?
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(magnify)
                    .simultaneousGesture(pan, including: scale > 1 ? .all : .none)
                    .onTapGesture(count: 2) {
                        withAnimation(.spring()) {
                            if scale > 1 { reset() } else { scale = 2.5; lastScale = 2.5 }
                        }
                    }
            case .failure:
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle)
                    Text("Couldn't load photo").font(.footnote)
                }
                .foregroundStyle(Theme.secondaryText)
            default:
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onDisappear(perform: reset)
    }

    private var magnify: some Gesture {
        MagnificationGesture()
            .onChanged { value in scale = min(max(lastScale * value, 1), 6) }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.01 { withAnimation(.spring()) { reset() } }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height)
            }
            .onEnded { _ in lastOffset = offset }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}
