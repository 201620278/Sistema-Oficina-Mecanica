const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');

let serverInstance;
let mainWindow = null;

async function waitForServer(url, maxAttempts = 30, interval = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Status ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(500, () => {
          req.abort();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, interval));
    }
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      const isGoogleOAuth =
        parsedUrl.hostname === 'accounts.google.com' ||
        parsedUrl.hostname === 'oauth2.googleapis.com';

      if (isGoogleOAuth) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    } catch (e) {
      /* ignore */
    }

    return { action: 'allow' };
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
    mainWindow.focus();
  });

  mainWindow.loadURL('http://localhost:3000');
}

app.whenReady().then(async () => {
  const { startServer } = require(path.join(__dirname, 'server.js'));
  serverInstance = startServer();

  // Aguarda servidor estar pronto antes de criar janela
  const serverReady = await waitForServer('http://localhost:3000');
  if (!serverReady) {
    console.error('Servidor não respondeu após 30 tentativas');
  }

  createWindow();
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