# Music Sync (iOS)

A native SwiftUI companion app for the desktop Music Player. It connects to the
Mac app over your local wifi, browses the library, streams songs, and downloads
them for offline playback (with lock-screen / Control Center controls).

> Status: first scaffold. It has **not** been compiled yet — expect a few small
> fixes when you first build it in Xcode. The desktop sync server it talks to is
> tested and working.

## What you need

- **Xcode** (free, from the Mac App Store, ~15 GB). The current Command Line
  Tools alone are not enough to build/run an iOS app.
- An **Apple ID** for signing. A free account works but the app must be
  re-installed from Xcode every 7 days; a paid Apple Developer account ($99/yr)
  lasts a year.
- Your iPhone and Mac on the **same wifi**.

## Build & run

1. Turn on sharing on the Mac: open **Music Player → Phone Sync → enable**. Note
   the **Address** and **Code** it shows.
2. Generate the Xcode project (one time, needs [XcodeGen](https://github.com/yonaskolb/XcodeGen)):
   ```bash
   brew install xcodegen        # if you don't have it
   cd ios
   xcodegen generate
   open MusicSync.xcodeproj
   ```
   No Homebrew? Instead: in Xcode, **File → New → Project → iOS App** (name it
   MusicSync, SwiftUI), delete its starter files, drag the `ios/MusicSync/*.swift`
   files in, and set the Info.plist keys listed in `project.yml` (Local Network
   usage, `NSAllowsLocalNetworking`, Background Modes → Audio).
3. In Xcode: select the **MusicSync** target → **Signing & Capabilities** → pick
   your Team (your Apple ID) and a unique bundle id if needed.
4. Plug in your iPhone, select it as the run destination, press **Run** (⌘R).
   First run: on the phone, trust the developer profile under
   **Settings → General → VPN & Device Management**.
5. In the app, enter the Address and Code from step 1, tap **Connect**.

## Notes

- Streaming works while you're on the same wifi as the Mac (with the desktop app
  open). Tap the download icon on a song or album to keep it for **offline**
  playback anywhere.
- Traffic is plain HTTP on your local network, gated by the pairing code. Use it
  on a network you trust.

## Roadmap

- QR-code pairing (scan instead of typing), Bonjour auto-discovery
- Playlists, On Repeat / Discover, search niceties
- Background bulk "sync everything" with progress
