import Foundation
import SwiftUI

/// Holds the connection, the fetched library, and on-device downloads.
@MainActor
final class LibraryStore: ObservableObject {
    @Published var connection: ServerConnection?
    @Published var tracks: [Track] = []
    @Published var loading = false
    @Published var errorMessage: String?
    @Published var downloaded: Set<String> = []   // track ids present on disk
    @Published var downloading: Set<String> = []

    private let defaults = UserDefaults.standard

    init() {
        if let data = defaults.data(forKey: "connection"),
           let conn = try? JSONDecoder().decode(ServerConnection.self, from: data) {
            connection = conn
        }
        refreshDownloaded()
    }

    var isConnected: Bool { connection != nil }

    // MARK: connection

    func ping(_ conn: ServerConnection) async -> Bool {
        guard let url = conn.pingURL() else { return false }
        do {
            let (_, resp) = try await URLSession.shared.data(from: url)
            return (resp as? HTTPURLResponse)?.statusCode == 200
        } catch { return false }
    }

    func save(_ conn: ServerConnection) {
        connection = conn
        if let data = try? JSONEncoder().encode(conn) { defaults.set(data, forKey: "connection") }
    }

    func disconnect() {
        connection = nil
        defaults.removeObject(forKey: "connection")
        tracks = []
    }

    func loadLibrary() async {
        guard let conn = connection, let url = conn.libraryURL() else { return }
        loading = true; errorMessage = nil
        do {
            let (data, resp) = try await URLSession.shared.data(from: url)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            tracks = try JSONDecoder().decode(LibraryResponse.self, from: data).tracks
        } catch {
            errorMessage = "Couldn't load the library. Make sure the Music Player app is open on your Mac and you're on the same wifi."
        }
        loading = false
    }

    // MARK: grouping

    var albums: [Album] {
        var map: [String: Album] = [:]
        for t in tracks {
            let key = t.albumKey
            if var a = map[key] {
                a.tracks.append(t)
                if a.artTrackID == nil && t.hasArt { a = Album(id: a.id, title: a.title, artist: a.artist, artTrackID: t.id, tracks: a.tracks) }
                map[key] = a
            } else {
                map[key] = Album(id: key, title: t.displayAlbum, artist: t.displayArtist, artTrackID: t.hasArt ? t.id : nil, tracks: [t])
            }
        }
        return map.values
            .map { Album(id: $0.id, title: $0.title, artist: $0.artist, artTrackID: $0.artTrackID,
                         tracks: $0.tracks.sorted { ($0.disc ?? 0, $0.track ?? 9999) < ($1.disc ?? 0, $1.track ?? 9999) }) }
            .sorted { $0.artist.localizedCaseInsensitiveCompare($1.artist) == .orderedAscending }
    }

    var sortedTracks: [Track] {
        tracks.sorted { $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending }
    }

    // MARK: downloads

    private func audioDir() -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("audio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func localFileURL(for t: Track) -> URL { audioDir().appendingPathComponent(t.id + (t.ext ?? "")) }
    func isDownloaded(_ t: Track) -> Bool { downloaded.contains(t.id) }

    func refreshDownloaded() {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: audioDir().path)) ?? []
        downloaded = Set(files.map { ($0 as NSString).deletingPathExtension })
    }

    func download(_ t: Track) {
        guard let url = connection?.audioURL(t.id), !downloading.contains(t.id), !isDownloaded(t) else { return }
        downloading.insert(t.id)
        let dest = localFileURL(for: t)
        URLSession.shared.downloadTask(with: url) { [weak self] tmp, _, _ in
            if let tmp {
                try? FileManager.default.removeItem(at: dest)
                try? FileManager.default.moveItem(at: tmp, to: dest)
            }
            Task { @MainActor in
                guard let self else { return }
                self.downloading.remove(t.id)
                if FileManager.default.fileExists(atPath: dest.path) { self.downloaded.insert(t.id) }
            }
        }.resume()
    }

    func downloadAll(_ list: [Track]) { for t in list { download(t) } }

    func deleteDownload(_ t: Track) {
        try? FileManager.default.removeItem(at: localFileURL(for: t))
        downloaded.remove(t.id)
    }

    var downloadedTracks: [Track] { sortedTracks.filter { isDownloaded($0) } }
}
