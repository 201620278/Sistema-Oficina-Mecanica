const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// remover items específicos (substitua pelos ids locais se quiser)
const ids = ['1765335128730czorj79yb','17653351286895xxttqsq4'];
const keys = ['financeiro-receber','financeiro-pagar','financeiro-sync-queue','financeiro-sync-queue-failed'];
ids.forEach(id => {
  keys.forEach(k=>{
    try {
      let arr = JSON.parse(localStorage.getItem(k) || '[]');
      arr = arr.filter(x => !(String(x.id)===String(id) || JSON.stringify(x).includes(id)));
      localStorage.setItem(k, JSON.stringify(arr));
    } catch(e){}
  });
});
console.log('LocalStorage atualizado. Atualize a página.');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  const placeholders = ids.map(()=>'?').join(',');
  const sql = `DELETE FROM transacoes WHERE id IN (${placeholders})`;
  db.run(sql, ids, function(err) {
    if (err) {
      console.error('Erro ao deletar:', err);
    } else {
      console.log(`Deletado(s): ${this.changes} linha(s).`);
      // opcional: listar novamente
      db.all('SELECT id, cliente_id, descricao, valor FROM transacoes ORDER BY id DESC LIMIT 50', [], (err2, rows) => {
        if (!err2) {
          console.log('Registros atuais (amostra):');
          rows.forEach(r => console.log(r));
        }
        db.close();
      });
    }
  });
});

db.serialize(() => {
  const sql = `DELETE FROM transacoes WHERE cliente_id = 1 AND valor = 450 AND descricao LIKE '%Orçamento 1%'`;
  db.run(sql, function(err) {
    if (err) {
      console.error('Erro ao deletar:', err);
    } else {
      console.log(`Deletado(s): ${this.changes} linha(s).`);
      // opcional: listar novamente
      db.all('SELECT id, cliente_id, descricao, valor FROM transacoes ORDER BY id DESC LIMIT 50', [], (err2, rows) => {
        if (!err2) {
          console.log('Registros atuais (amostra):');
          rows.forEach(r => console.log(r));
        }
        db.close();
      });
    }
  });
});
