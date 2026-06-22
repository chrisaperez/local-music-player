import SwiftUI

// MARK: - Cover art

struct ArtImage: View {
    @EnvironmentObject var store: LibraryStore
    let track: Track?

    var body: some View {
        if let track, track.hasArt, let url = store.connection?.artURL(track.id) {
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            Color.gray.opacity(0.18)
            Image(systemName: "music.note").foregroundStyle(.secondary)
        }
    }
}

// MARK: - Connect

struct ConnectView: View {
    @EnvironmentObject var store: LibraryStore
    @State private var host = ""
    @State private var code = ""
    @State private var checking = false
    @State private var failed = false

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "wave.3.right.circle.fill")
                .font(.system(size: 60)).foregroundStyle(.green)
            Text("Connect to your Mac").font(.title2.bold())
            Text("On your Mac, open Music Player → **Phone Sync**, turn it on, then type the Address and Code shown there.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal)

            TextField("Address  (e.g. 192.168.1.20:8787)", text: $host)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            TextField("Code", text: $code)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.characters).autocorrectionDisabled()

            if failed {
                Text("Couldn't connect. Check the address, code, and that you're on the same wifi.")
                    .font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }

            Button(action: { Task { await connect() } }) {
                Group { if checking { ProgressView() } else { Text("Connect").bold() } }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(host.isEmpty || code.isEmpty || checking)

            Spacer()
        }
        .padding(24)
    }

    private func connect() async {
        checking = true; failed = false
        let conn = ServerConnection(
            host: host.trimmingCharacters(in: .whitespaces),
            token: code.trimmingCharacters(in: .whitespaces).uppercased()
        )
        if await store.ping(conn) {
            store.save(conn)
            await store.loadLibrary()
        } else {
            failed = true
        }
        checking = false
    }
}

// MARK: - Main tabs

struct MainTabsView: View {
    @EnvironmentObject var store: LibraryStore
    @EnvironmentObject var player: AudioPlayer
    @State private var showPlayer = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView {
                SongsView().tabItem { Label("Songs", systemImage: "music.note.list") }
                AlbumsView().tabItem { Label("Albums", systemImage: "square.stack") }
                DownloadsView().tabItem { Label("Downloads", systemImage: "arrow.down.circle") }
                SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }
            }
            if player.current != nil {
                NowPlayingBar(onTap: { showPlayer = true })
                    .padding(.bottom, 49) // sit just above the tab bar
            }
        }
        .sheet(isPresented: $showPlayer) { NowPlayingSheet() }
        .task { if store.tracks.isEmpty { await store.loadLibrary() } }
    }
}

// MARK: - Songs

struct SongsView: View {
    @EnvironmentObject var store: LibraryStore
    @EnvironmentObject var player: AudioPlayer
    @State private var query = ""

    private var filtered: [Track] {
        let list = store.sortedTracks
        guard !query.isEmpty else { return list }
        let q = query.lowercased()
        return list.filter {
            $0.displayTitle.lowercased().contains(q) ||
            $0.displayArtist.lowercased().contains(q) ||
            $0.displayAlbum.lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(filtered.enumerated()), id: \.element.id) { index, track in
                    SongRow(track: track) { player.play(filtered, startAt: index) }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Songs")
            .searchable(text: $query)
            .refreshable { await store.loadLibrary() }
            .overlay { if store.loading && store.tracks.isEmpty { ProgressView() } }
        }
    }
}

struct SongRow: View {
    @EnvironmentObject var store: LibraryStore
    @EnvironmentObject var player: AudioPlayer
    let track: Track
    var onPlay: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ArtImage(track: track).frame(width: 46, height: 46).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(track.displayTitle).lineLimit(1)
                    .foregroundStyle(player.current?.id == track.id ? Color.green : Color.primary)
                Text(track.displayArtist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            downloadIndicator
        }
        .contentShape(Rectangle())
        .onTapGesture { onPlay() }
    }

    @ViewBuilder private var downloadIndicator: some View {
        if store.downloading.contains(track.id) {
            ProgressView()
        } else if store.isDownloaded(track) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        } else {
            Button { store.download(track) } label: {
                Image(systemName: "arrow.down.circle").foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Albums

struct AlbumsView: View {
    @EnvironmentObject var store: LibraryStore
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 16)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(store.albums) { album in
                        NavigationLink(value: album.id) {
                            VStack(alignment: .leading, spacing: 6) {
                                ArtImage(track: coverTrack(album))
                                    .aspectRatio(1, contentMode: .fill)
                                    .frame(maxWidth: .infinity)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                Text(album.title).font(.subheadline.bold()).lineLimit(1)
                                Text(album.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .navigationTitle("Albums")
            .navigationDestination(for: String.self) { id in
                if let album = store.albums.first(where: { $0.id == id }) {
                    AlbumDetailView(album: album)
                }
            }
        }
    }

    private func coverTrack(_ album: Album) -> Track? {
        album.tracks.first(where: { $0.id == album.artTrackID }) ?? album.tracks.first
    }
}

struct AlbumDetailView: View {
    @EnvironmentObject var store: LibraryStore
    @EnvironmentObject var player: AudioPlayer
    let album: Album

    var body: some View {
        List {
            Section {
                VStack(spacing: 10) {
                    ArtImage(track: album.tracks.first(where: { $0.id == album.artTrackID }) ?? album.tracks.first)
                        .aspectRatio(1, contentMode: .fit).frame(maxWidth: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Text(album.title).font(.title3.bold()).multilineTextAlignment(.center)
                    Text(album.artist).foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        Button { player.play(album.tracks, startAt: 0) } label: { Label("Play", systemImage: "play.fill") }
                            .buttonStyle(.borderedProminent)
                        Button { store.downloadAll(album.tracks) } label: { Label("Download", systemImage: "arrow.down") }
                            .buttonStyle(.bordered)
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            Section {
                ForEach(Array(album.tracks.enumerated()), id: \.element.id) { index, track in
                    SongRow(track: track) { player.play(album.tracks, startAt: index) }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(album.title).navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Downloads & Settings

struct DownloadsView: View {
    @EnvironmentObject var store: LibraryStore
    @EnvironmentObject var player: AudioPlayer

    var body: some View {
        NavigationStack {
            let list = store.downloadedTracks
            Group {
                if list.isEmpty {
                    ContentUnavailableView("No downloads yet", systemImage: "arrow.down.circle",
                        description: Text("Tap the download icon on a song or album to save it for offline."))
                } else {
                    List {
                        ForEach(Array(list.enumerated()), id: \.element.id) { index, track in
                            SongRow(track: track) { player.play(list, startAt: index) }
                                .swipeActions {
                                    Button(role: .destructive) { store.deleteDownload(track) } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Downloads")
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var store: LibraryStore

    var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    if let conn = store.connection {
                        LabeledContent("Mac", value: conn.host)
                    }
                    Button("Reload library") { Task { await store.loadLibrary() } }
                    Button("Disconnect", role: .destructive) { store.disconnect() }
                }
                Section("Storage") {
                    LabeledContent("Downloaded songs", value: "\(store.downloaded.count)")
                }
            }
            .navigationTitle("Settings")
        }
    }
}

// MARK: - Now Playing

struct NowPlayingBar: View {
    @EnvironmentObject var player: AudioPlayer
    var onTap: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ArtImage(track: player.current).frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 5))
            VStack(alignment: .leading, spacing: 1) {
                Text(player.current?.displayTitle ?? "").font(.subheadline).lineLimit(1)
                Text(player.current?.displayArtist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Button { player.toggle() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3)
            }.buttonStyle(.plain)
            Button { player.next() } label: { Image(systemName: "forward.fill").font(.title3) }.buttonStyle(.plain)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }
}

struct NowPlayingSheet: View {
    @EnvironmentObject var player: AudioPlayer

    var body: some View {
        VStack(spacing: 22) {
            Capsule().fill(.secondary).frame(width: 40, height: 5).padding(.top, 8)
            ArtImage(track: player.current)
                .aspectRatio(1, contentMode: .fit).frame(maxWidth: 320)
                .clipShape(RoundedRectangle(cornerRadius: 14)).padding(.horizontal)
            VStack(spacing: 4) {
                Text(player.current?.displayTitle ?? "").font(.title2.bold()).lineLimit(1)
                Text(player.current?.displayArtist ?? "").foregroundStyle(.secondary).lineLimit(1)
            }
            VStack(spacing: 4) {
                Slider(value: Binding(get: { player.progress }, set: { player.seek(toFraction: $0) }))
                    .tint(.green)
                HStack {
                    Text(formatTime(player.elapsed)).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Text(formatTime(player.duration)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            HStack(spacing: 44) {
                Button { player.prev() } label: { Image(systemName: "backward.fill").font(.title) }
                Button { player.toggle() } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 64))
                }
                Button { player.next() } label: { Image(systemName: "forward.fill").font(.title) }
            }
            .foregroundStyle(.primary)
            Spacer()
        }
        .padding()
        .presentationDragIndicator(.hidden)
    }
}
