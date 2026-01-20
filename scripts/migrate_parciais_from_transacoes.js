const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) { console.error('Erro ao abrir DB:', err.message); process.exit(1); }
});

// Encontrar transacoes com valor_pago preenchido
const findSql = `SELECT id, valor_pago, ultimo_pagamento_parcial, observacoes FROM transacoes WHERE (valor_pago IS NOT NULL AND valor_pago <> 0)`;

db.all(findSql, [], (err, rows) => {
  if (err) { console.error('Erro ao consultar transacoes:', err.message); process.exit(1); }
  if (!rows || rows.length === 0) {
    console.log('Nenhuma transacao com valor_pago encontrada. Nada a migrar.');
    db.close();
    return;
  }

  let inserted = 0;
  let processed = 0;

  rows.forEach(r => {
    const transacaoId = r.id;
    const valorPago = r.valor_pago || r.valorPago;
    const dataPag = r.ultimo_pagamento_parcial || new Date().toISOString().split('T')[0];
    const obs = r.observacoes || r.observacoes || null;

    // Verificar se já existe um pagamento_parcial para essa transacao com mesmo valor e data
    db.get('SELECT COUNT(1) AS cnt FROM pagamentos_parciais WHERE transacao_id = ? AND valor_pago = ? AND data_pagamento = ?', [transacaoId, valorPago, dataPag], (e, existing) => {
      processed++;
      if (e) { console.error('Erro ao checar pagamentos_parciais:', e.message); return; }
      if (existing && existing.cnt > 0) {
        // já existe
      } else {
        db.run('INSERT INTO pagamentos_parciais (transacao_id, valor_pago, data_pagamento, observacoes, created_at) VALUES (?, ?, ?, ?, datetime("now"))', [transacaoId, valorPago, dataPag, obs], function(insErr) {
          if (insErr) { console.error('Erro ao inserir pagamento_parcial para transacao', transacaoId, insErr.message); }
          else { inserted++; console.log('Inserido parcial:', { transacaoId, valorPago, dataPag }); }
        });
      }

      // Ao terminar
      if (processed === rows.length) {
        console.log('Migração finalizada. Inseridos:', inserted);
        db.close();
      }
    });
  });
});
