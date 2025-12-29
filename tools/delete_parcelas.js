const sqlite3 = require('sqlite3').verbose();
const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Uso: node delete_parcelas.js <id1> <id2> ...');
  process.exit(1);
}
const db = new sqlite3.Database('database.db', (err) => { if (err) { console.error(err); process.exit(1); } });
const placeholders = ids.map(()=>'?').join(',');
const sql = `DELETE FROM transacoes WHERE id IN (${placeholders})`;
db.run(sql, ids, function(err){
  if (err) { console.error('Erro ao deletar:', err); process.exit(1); }
  console.log(`Deletado(s): ${this.changes} linha(s).`);
  db.all('SELECT id, descricao, valor, grupo_parcelamento_id FROM transacoes WHERE descricao LIKE "Orçamento % - Parcela %" ORDER BY created_at DESC LIMIT 50', [], (e, rows) => {
    if (!e) console.log('Registros restantes (amostra):', JSON.stringify(rows, null, 2));
    db.close();
  });
});
