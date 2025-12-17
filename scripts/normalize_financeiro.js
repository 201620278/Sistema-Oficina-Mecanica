const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const dataJsonPath = path.join(__dirname, '..', 'data.json');

function normalizeValorRaw(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  s = s.replace(/\s/g, '');
  s = s.replace(/R\$|r\$/g, '');
  if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
    s = s.replace(/\./g, '');
    s = s.replace(/,/g, '.');
  } else {
    if (s.indexOf(',') !== -1) s = s.replace(/,/g, '.');
  }
  s = s.replace(/[^0-9.-]/g, '');
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function normalizeDateRaw(v) {
  if (!v) return null;
  const s = String(v).trim();
  const dmY = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/;
  if (dmY.test(s)) {
    const m = s.match(dmY);
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

console.log('Abrindo DB:', dbPath);
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Erro ao abrir DB:', err.message);
    process.exit(1);
  }

  console.log('Iniciando migração de campos financeiros...');

  db.all('SELECT id, valor, vencimento FROM transacoes', [], (err, rows) => {
    if (err) {
      console.error('Erro ao ler transacoes:', err.message);
      db.close();
      return;
    }

    const updates = [];
    rows.forEach(r => {
      const novoValor = normalizeValorRaw(r.valor);
      const novoVenc = normalizeDateRaw(r.vencimento);
      if ((novoValor !== null && novoValor !== r.valor) || (novoVenc && novoVenc !== r.vencimento)) {
        updates.push({ id: r.id, valor: novoValor, vencimento: novoVenc });
      }
    });

    console.log(`Registros a atualizar: ${updates.length}`);
    let done = 0;
    if (updates.length === 0) {
      afterDb();
      return;
    }

    updates.forEach(u => {
      const params = [];
      const sets = [];
      if (u.valor !== null) { sets.push('valor = ?'); params.push(u.valor); }
      if (u.vencimento) { sets.push('vencimento = ?'); params.push(u.vencimento); }
      if (sets.length === 0) { done++; if (done === updates.length) afterDb(); return; }
      const sql = `UPDATE transacoes SET ${sets.join(', ')} WHERE id = ?`;
      params.push(u.id);
      db.run(sql, params, function(err) {
        if (err) console.error('Erro ao atualizar id', u.id, err.message);
        done++;
        if (done === updates.length) afterDb();
      });
    });
  });

  function afterDb() {
    // Atualizar data.json se existir
    if (fs.existsSync(dataJsonPath)) {
      try {
        const raw = fs.readFileSync(dataJsonPath, 'utf8');
        const data = JSON.parse(raw);
        ['receber', 'pagar'].forEach(key => {
          if (Array.isArray(data[key])) {
            data[key] = data[key].map(item => {
              const novo = { ...item };
              const v = normalizeValorRaw(novo.valor);
              const ven = normalizeDateRaw(novo.vencimento || novo.vencimento);
              if (v !== null) novo.valor = v;
              if (ven) novo.vencimento = ven;
              return novo;
            });
          }
        });
        fs.writeFileSync(dataJsonPath, JSON.stringify(data, null, 2), 'utf8');
        console.log('Arquivo data.json atualizado');
      } catch (e) {
        console.error('Erro ao atualizar data.json:', e.message);
      }
    } else {
      console.log('data.json não encontrado — pulando atualização JSON');
    }

    db.close(() => {
      console.log('Migração finalizada e conexão fechada.');
    });
  }
});
