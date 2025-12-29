const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.all("SELECT id, descricao, valor, grupo_parcelamento_id, created_at FROM transacoes WHERE descricao LIKE 'Orçamento % - Parcela %' ORDER BY created_at DESC LIMIT 200", [], (err, rows) => {
  if (err) { console.error('Erro:', err); process.exit(1); }
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
