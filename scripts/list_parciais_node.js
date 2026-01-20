const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error('Erro ao abrir DB:', err.message); process.exit(1); }
});

db.all('SELECT id, transacao_id, valor_pago, data_pagamento, observacoes, created_at FROM pagamentos_parciais ORDER BY created_at DESC LIMIT 100', [], (err, rows) => {
  if (err) { console.error('ERR', err); process.exit(1); }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
