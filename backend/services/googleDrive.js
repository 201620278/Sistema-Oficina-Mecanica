const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TOKEN_DIR = path.join(process.cwd(), 'backend', 'storage');
const TOKEN_PATH = path.join(TOKEN_DIR, 'google-drive-token.json');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function ensureGoogleCredentials() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error('Credenciais do Google Drive não configuradas.');
  }
}

function ensureTokenDir() {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

function createOAuthClient() {
  ensureGoogleCredentials();
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function saveToken(token) {
  ensureTokenDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;

  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function deleteToken() {
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }
}

function setSavedCredentials(oAuth2Client) {
  const token = loadToken();
  if (!token) return false;

  oAuth2Client.setCredentials(token);
  return true;
}

function getAuthUrl() {
  const oAuth2Client = createOAuthClient();

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });

  return authUrl;
}

async function exchangeCodeForToken(code) {
  const oAuth2Client = createOAuthClient();

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  saveToken(tokens);

  return {
    success: true,
    message: 'Google Drive conectado com sucesso.',
  };
}

async function getAuthorizedClientOrThrow() {
  const oAuth2Client = createOAuthClient();
  const hasToken = setSavedCredentials(oAuth2Client);

  if (!hasToken) {
    const error = new Error('GOOGLE_AUTH_REQUIRED');
    error.code = 'GOOGLE_AUTH_REQUIRED';
    throw error;
  }

  try {
    await oAuth2Client.getAccessToken();
    return oAuth2Client;
  } catch (err) {
    const msg = err?.response?.data?.error || err?.message || '';

    if (String(msg).includes('invalid_grant')) {
      deleteToken();

      const error = new Error('GOOGLE_AUTH_REQUIRED');
      error.code = 'GOOGLE_AUTH_REQUIRED';
      throw error;
    }

    throw err;
  }
}

async function uploadFileToDrive(
  filePath,
  fileName,
  mimeType = 'application/octet-stream'
) {
  const auth = await getAuthorizedClientOrThrow();
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: 'id,name',
  });

  return response.data;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForToken,
  uploadFileToDrive,
  deleteToken,
  TOKEN_PATH,
};
