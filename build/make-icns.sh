#!/bin/bash
# Builds build/icon.icns from build/icon-1024.png (a >=1024px square master).
# To customize the app logo: replace build/icon.svg (then `npm run icon`) or drop
# your own square PNG in as build/icon-1024.png, then run `npm run icns`.
set -e
cd "$(dirname "$0")"
SRC="icon-1024.png"
SET="icon.iconset"
rm -rf "$SET"
mkdir -p "$SET"
sips -z 16 16     "$SRC" --out "$SET/icon_16x16.png"      >/dev/null
sips -z 32 32     "$SRC" --out "$SET/icon_16x16@2x.png"   >/dev/null
sips -z 32 32     "$SRC" --out "$SET/icon_32x32.png"      >/dev/null
sips -z 64 64     "$SRC" --out "$SET/icon_32x32@2x.png"   >/dev/null
sips -z 128 128   "$SRC" --out "$SET/icon_128x128.png"    >/dev/null
sips -z 256 256   "$SRC" --out "$SET/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$SRC" --out "$SET/icon_256x256.png"    >/dev/null
sips -z 512 512   "$SRC" --out "$SET/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$SRC" --out "$SET/icon_512x512.png"    >/dev/null
sips -z 1024 1024 "$SRC" --out "$SET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$SET" -o icon.icns
rm -rf "$SET"
echo "wrote $(pwd)/icon.icns"
