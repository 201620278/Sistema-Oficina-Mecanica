const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const id = process.argv[2];
if (!id) { console.error('Uso: node check_financeiro_id.js <id>'); process.exit(2); }
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err)=>{
  if (err) { console.error('Erro ao abrir DB:', err.message); process.exit(3); }
});

db.get('SELECT * FROM transacoes WHERE id = ?', [id], (err, row) => {
  if (err) { console.error('Erro na query:', err.message); process.exit(4); }
  if (!row) {
    console.log('NOT_FOUND');
    process.exit(0);
  }
  console.log('FOUND');
  console.log(JSON.stringify(row, null, 2));
  process.exit(0);
});
