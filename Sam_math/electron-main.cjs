const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 850, minWidth: 900, minHeight: 650,
    title: 'SAM MATH', autoHideMenuBar: true, backgroundColor: '#090d1d',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
