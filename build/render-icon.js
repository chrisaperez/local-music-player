'use strict';
// Renders build/icon.svg to build/icon-1024.png using Chromium (so gradients,
// clip-paths, filters and an embedded photo render exactly). Run via: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  let svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');

  // Inline a background photo (build/bg.png|jpg) into the __BG__ placeholder.
  if (svg.includes('__BG__')) {
    const bg = ['bg.png', 'bg.jpg', 'bg.jpeg'].map((f) => path.join(__dirname, f)).find((p) => fs.existsSync(p));
    if (bg) {
      const ext = path.extname(bg).slice(1).toLowerCase().replace('jpg', 'jpeg');
      const b64 = fs.readFileSync(bg).toString('base64');
      svg = svg.replace(/__BG__/g, `data:image/${ext};base64,${b64}`);
    }
  }

  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent;overflow:hidden}svg{display:block;width:1024px;height:1024px}</style>' +
    '</head><body>' + svg + '</body></html>';
  // Write to a temp file and loadFile it — avoids data:-URL length limits when
  // the SVG embeds a multi-MB photo.
  const tmp = path.join(__dirname, '.render.html');
  fs.writeFileSync(tmp, html);

  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true,
    webPreferences: { offscreen: true },
  });

  try {
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 600));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    fs.writeFileSync(path.join(__dirname, 'icon-1024.png'), img.toPNG());
    console.log('icon-1024.png written');
  } catch (e) {
    console.error('render failed:', e);
    process.exitCode = 1;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    win.destroy();
    app.quit();
  }
});
