import Foundation

/// A track as sent by the desktop app's /api/library endpoint.
struct Track: Identifiable, Codable, Hashable {
    let id: String
    let title: String?
    let artist: String?
    let albumArtist: String?
    let album: String?
    let track: Int?
    let disc: Int?
    let year: Int?
    let genre: String?
    let duration: Double?
    let hasArt: Bool
    let ext: String?

    var displayTitle: String { nonEmpty(title) ?? "Unknown" }
    var displayArtist: String { nonEmpty(artist) ?? nonEmpty(albumArtist) ?? "Unknown Artist" }
    var displayAlbum: String { nonEmpty(album) ?? "Unknown Album" }
    var albumKey: String { (nonEmpty(albumArtist) ?? displayArtist) + "\u{0000}" + displayAlbum }
}

struct LibraryResponse: Codable { let tracks: [Track] }

/// Grouped album for the Albums tab.
struct Album: Identifiable {
    let id: String
    let title: String
    let artist: String
    let artTrackID: String?
    var tracks: [Track]
}

/// Connection to a desktop instance: "192.168.x.x:8787" + pairing code.
struct ServerConnection: Codable, Equatable {
    var host: String
    var token: String

    private func make(_ pathAndQuery: String) -> URL? { URL(string: "http://\(host)/api/\(pathAndQuery)") }
    func pingURL() -> URL? { make("ping?token=\(token)") }
    func libraryURL() -> URL? { make("library?token=\(token)") }
    func audioURL(_ id: String) -> URL? { make("audio/\(id)?token=\(token)") }
    func artURL(_ id: String) -> URL? { make("art/\(id)?token=\(token)") }
}

private func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return s
}

func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    let s = Int(seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
