const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => { if (err) { console.error(err); process.exit(1); } });

db.all("SELECT id, descricao, status, valor, valor_pago, valor_pago AS valorPago, valor_restante, ultimo_pagamento_parcial, created_at FROM transacoes WHERE LOWER(COALESCE(status,'')) LIKE '%parcial%' OR valor_pago IS NOT NULL OR valor_pago > 0 LIMIT 100", [], (err, rows) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
