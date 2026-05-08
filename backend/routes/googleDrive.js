const express = require('express');
const path = require('path');
const fs = require('fs');
const { app: electronApp } = require('electron');
const {
  getAuthUrl,
  exchangeCodeForToken,
  uploadFileToDrive,
  TOKEN_PATH,
} = require('../services/googleDrive');

const router = express.Router();

function hasGoogleCredentialsConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI
  );
}

function resolveDatabasePath() {
  const candidates = [];

  try {
    const userDataPath = electronApp.getPath('userData');
    candidates.push(path.join(userDataPath, 'database.db'));
  } catch (_) {
    // ignore
  }

  candidates.push(path.join(process.cwd(), 'database.db'));

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'database.db'));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function formatDateTimeSafe(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

router.get('/status', (req, res) => {
  return res.json({
    success: true,
    configured: hasGoogleCredentialsConfigured(),
    connected: fs.existsSync(TOKEN_PATH),
  });
});

router.get('/auth/url', (req, res) => {
  try {
    const url = getAuthUrl();
    return res.json({ success: true, url });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao gerar URL de autenticação do Google Drive.',
      error: error.message,
    });
  }
});

router.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send('Código de autorização não recebido.');
    }

    await exchangeCodeForToken(code);

    return res.send(`
      <script>
        window.close();
      </script>
      Google Drive conectado com sucesso. Pode fechar esta janela.
    `);
  } catch (error) {
    return res.status(500).send(`Erro na autenticação: ${error.message}`);
  }
});

router.post('/backup', async (req, res) => {
  let tempFilePath = null;

  try {
    const dbPath = resolveDatabasePath();
    if (!dbPath) {
      return res.status(404).json({
        success: false,
        message: 'Banco de dados não encontrado para gerar backup.',
      });
    }

    const tempDir = path.join(process.cwd(), 'backend', 'storage');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const stamp = formatDateTimeSafe();
    tempFilePath = path.join(tempDir, `database-backup-${stamp}.db`);

    fs.copyFileSync(dbPath, tempFilePath);

    const result = await uploadFileToDrive(
      tempFilePath,
      `negocar-database-${stamp}.db`,
      'application/octet-stream'
    );

    return res.json({
      success: true,
      message: 'Backup enviado com sucesso para o Google Drive.',
      file: result,
    });
  } catch (error) {
    if (error.code === 'GOOGLE_AUTH_REQUIRED') {
      return res.status(401).json({
        success: false,
        code: 'GOOGLE_AUTH_REQUIRED',
        message: 'Sua conta Google precisa ser conectada novamente.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Erro ao enviar backup para o Google Drive.',
      error: error.message,
    });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {
        // ignore
      }
    }
  }
});

module.exports = router;
