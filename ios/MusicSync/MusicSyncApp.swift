import SwiftUI

@main
struct MusicSyncApp: App {
    @StateObject private var store = LibraryStore()
    @StateObject private var player = AudioPlayer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(player)
                .tint(.green)
                .onAppear { player.attach(store: store) }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: LibraryStore

    var body: some View {
        if store.isConnected {
            MainTabsView()
        } else {
            ConnectView()
        }
    }
}
