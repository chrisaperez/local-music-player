const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const store = require('./src/main/store');
const library = require('./src/main/library');

app.whenReady().then(async () => {
  const { libraryRoot } = store.getSettings();
  console.log("Root:", libraryRoot);
  const result = await library.scan(libraryRoot);
  console.log("Scan 1:", result.tracks.length);
  const result2 = await library.scan(libraryRoot);
  console.log("Scan 2:", result2.tracks.length);
  app.quit();
});
