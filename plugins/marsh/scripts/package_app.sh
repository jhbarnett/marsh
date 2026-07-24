#!/bin/sh
# Build dist/Marsh.app (a shell-launcher bundle that runs marsh-up.sh for this
# hub) and wrap it in dist/Marsh.dmg. No Xcode, no signing — first launch on a
# fresh machine needs right-click → Open (unsigned local app).
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST="$HUB/dist"
APP="$DIST/Marsh.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Marsh</string>
  <key>CFBundleDisplayName</key><string>Marsh</string>
  <key>CFBundleIdentifier</key><string>dev.marsh.workbench</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>marsh</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/marsh" <<LAUNCH
#!/bin/sh
# Marsh cockpit launcher — hub path baked at package time.
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
export MARSH_HUB="$HUB"
exec "$HUB/plugins/marsh/scripts/marsh-up.sh"
LAUNCH
chmod +x "$APP/Contents/MacOS/marsh"

rm -f "$DIST/Marsh.dmg"
hdiutil create -volname Marsh -srcfolder "$APP" -ov -format UDZO "$DIST/Marsh.dmg" >/dev/null
echo "built: $APP and $DIST/Marsh.dmg"
