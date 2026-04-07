const { app, BrowserWindow } = require('electron');
const path = require('path');

let serverInstance;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true
    }
  });

  mainWindow.webContents.on('did-create-window', (childWindow) => {
    try {
      childWindow.maximize();
    } catch (e) {
      /* ignore */
    }
    childWindow.once('ready-to-show', () => {
      try {
        if (!childWindow.isDestroyed()) childWindow.maximize();
      } catch (e2) {
        /* ignore */
      }
    });
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.loadURL('http://localhost:3000');
}

app.whenReady().then(() => {
  const { startServer } = require(path.join(__dirname, 'server.js'));
  serverInstance = startServer();

  setTimeout(() => {
    createWindow();
  }, 3000);
});

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
  }
});