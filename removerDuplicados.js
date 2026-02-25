const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');
db.serialize(() => {
  db.all("SELECT telefone, MIN(id) as keep_id FROM clientes WHERE telefone IS NOT NULL AND telefone != '' GROUP BY telefone HAVING COUNT(*) > 1", [], (err, dups) => {
    if (err) {
      console.error('Erro ao buscar duplicados:', err);
      process.exit(1);
    }
    let pending = dups.length;
    if (pending === 0) {
      console.log('Nenhum duplicado encontrado.');
      db.close();
      return;
    }
    dups.forEach(dup => {
      db.run("DELETE FROM clientes WHERE telefone = ? AND id != ?", [dup.telefone, dup.keep_id], function(err) {
        if (err) {
          console.error('Erro ao remover duplicado:', err);
        }
        if (--pending === 0) {
          console.log('Remoção de duplicados concluída.');
          db.close();
        }
      });
    });
  });
});
