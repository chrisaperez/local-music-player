import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// Streams (or plays the downloaded copy of) tracks with a simple queue,
/// plus Control Center / lock-screen integration.
@MainActor
final class AudioPlayer: ObservableObject {
    @Published var current: Track?
    @Published var isPlaying = false
    @Published var elapsed: Double = 0
    @Published var duration: Double = 0

    var progress: Double { duration > 0 ? min(1, elapsed / duration) : 0 }

    private let player = AVPlayer()
    private var queue: [Track] = []
    private var index = 0
    private weak var store: LibraryStore?
    private var timeObserver: Any?

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            guard let self else { return }
            self.elapsed = time.seconds
            if let d = self.player.currentItem?.duration.seconds, d.isFinite, d > 0 { self.duration = d }
            self.updateNowPlaying()
        }

        NotificationCenter.default.addObserver(
            self, selector: #selector(itemEnded),
            name: .AVPlayerItemDidPlayToEndTime, object: nil
        )
        setupRemoteCommands()
    }

    func attach(store: LibraryStore) { self.store = store }

    // MARK: transport

    func play(_ list: [Track], startAt: Int) {
        queue = list
        index = max(0, min(startAt, list.count - 1))
        loadCurrent(autoplay: true)
    }

    func toggle() { setPlaying(!isPlaying) }

    func setPlaying(_ playing: Bool) {
        isPlaying = playing
        if playing { player.play() } else { player.pause() }
        updateNowPlaying()
    }

    func next() {
        if index < queue.count - 1 { index += 1; loadCurrent(autoplay: true) }
        else { setPlaying(false) }
    }

    func prev() {
        if elapsed > 3 { seek(toFraction: 0) }
        else if index > 0 { index -= 1; loadCurrent(autoplay: true) }
        else { seek(toFraction: 0) }
    }

    func seek(toFraction f: Double) {
        let total = duration > 0 ? duration : (current?.duration ?? 0)
        player.seek(to: CMTime(seconds: max(0, min(1, f)) * total, preferredTimescale: 600))
    }

    @objc private func itemEnded() { Task { @MainActor in self.next() } }

    // MARK: internals

    private func itemURL(_ t: Track) -> URL? {
        if let store, FileManager.default.fileExists(atPath: store.localFileURL(for: t).path) {
            return store.localFileURL(for: t)
        }
        return store?.connection?.audioURL(t.id)
    }

    private func loadCurrent(autoplay: Bool) {
        guard let t = queue[safe: index], let url = itemURL(t) else { return }
        current = t
        duration = t.duration ?? 0
        elapsed = 0
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        setPlaying(autoplay)
        loadArtwork(for: t)
    }

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in Task { @MainActor in self?.setPlaying(true) }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.setPlaying(false) }; return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in Task { @MainActor in self?.toggle() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.next() }; return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in Task { @MainActor in self?.prev() }; return .success }
    }

    private var nowPlayingInfo: [String: Any] = [:]

    private func updateNowPlaying() {
        nowPlayingInfo[MPMediaItemPropertyTitle] = current?.displayTitle ?? ""
        nowPlayingInfo[MPMediaItemPropertyArtist] = current?.displayArtist ?? ""
        nowPlayingInfo[MPMediaItemPropertyAlbumTitle] = current?.displayAlbum ?? ""
        nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = duration
        nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo
    }

    private func loadArtwork(for t: Track) {
        guard t.hasArt, let url = store?.connection?.artURL(t.id) else { return }
        let tid = t.id
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            Task { @MainActor in
                guard let self, self.current?.id == tid else { return }
                self.nowPlayingInfo[MPMediaItemPropertyArtwork] = artwork
                self.updateNowPlaying()
            }
        }.resume()
    }
}
