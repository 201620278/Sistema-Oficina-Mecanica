const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Erro abrindo DB:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.all("PRAGMA table_info(transacoes)", [], (err, cols) => {
    if (err) {
      console.error('Erro obtendo colunas:', err.message);
      db.close();
      process.exit(1);
    }
    console.log('Colunas da tabela transacoes:');
    console.log(cols.map(c => c.name).join(', '));

    db.all("SELECT * FROM transacoes ORDER BY id DESC LIMIT 50", [], (err2, rows) => {
      if (err2) {
        console.error('Erro na query:', err2.message);
        db.close();
        process.exit(1);
      }
      if (!rows || rows.length === 0) {
        console.log('Nenhum registro "receber" encontrado.');
        db.close();
        return;
      }
      console.log('\nÚltimos registros em transacoes (até 50):');
      rows.forEach(r => {
        // imprimir algumas colunas conhecidas e qualquer outra chave dinâmica
        console.log(`- id=${r.id}  descricao=${r.descricao || ''}  valor=${r.valor || 0}  venc=${r.vencimento || r.data || ''}  status=${r.status || ''}  raw=${JSON.stringify(r)}`);
      });
      db.close();
    });
  });
});
