# AUDITORIA COMPLETA DO MÓDULO FINANCEIRO

## 🔴 PROBLEMAS CRÍTICOS ENCONTRADOS

### 1. **DUAL PERSISTENCE - Banco SQLite + data.json dessincronizados**
**Localização:** `server.js` linhas 2244-2267  
**Problema:** O sistema salva financeiro em DOIS lugares:
- SQLite (tabela `transacoes`)
- JSON (`data.json`)

Quando um POST `/api/financeiro` é feito:
- Salva no SQLite: ✅
- Salva no `data.json`: ✅
- MAS se alguém fizer DELETE/cleanup no banco, `data.json` NÃO é atualizado
- Resultado: GET retorna do SQLite (correto), mas `data.json` fica com dados antigos

**Solução:** Remover `data.json` como fonte primária ou sincronizar DELETE/cleanup.

---

### 2. **GET /api/financeiro retorna com normalizeFinanceiroRow INCOMPLETA**
**Localização:** `server.js` linhas 2390-2420  
**Problema:** 
```javascript
const dados = rows.map(row => normalizeFinanceiroRow({ ...row, id: row.id ? String(row.id) : null }));
```
- Chama `normalizeFinanceiroRow()` que normaliza valores e datas
- MAS as colunas mapeadas NO GET não incluem todos os campos que estão na tabela
- `normalizeFinanceiroRow` não normaliza `orcamentoId` (pode ser NULL ou string)
- `normalizeFinanceiroRow` não normaliza `clienteId` (pode ser NULL ou string)
- `normalizeFinanceiroRow` não inclui `grupoParcelamentoId` retornado

**Solução:** Aplicar normalização completa (incluir camelCase mapping).

---

### 3. **GET /api/financeiro/:tipo não retorna com normalizeFinanceiroRow**
**Localização:** `server.js` linhas 2369-2389  
**Problema:** 
```javascript
const dados = rows.map(row => ({
    id: row.id ? String(row.id) : null,
    descricao: row.descricao,
    // ... etc manual mapping
```
- NÃO chama `normalizeFinanceiroRow()`
- Manual maping é propenso a erros
- Valores não são normalizados (podem ser strings "100,00")
- Comportamento inconsistente com GET `/api/financeiro`

**Solução:** Usar `normalizeFinanceiroRow()` em ambos os GET.

---

### 4. **POST /api/financeiro não retorna todos os campos sincronizados**
**Localização:** `server.js` linhas 2520-2558  
**Problema:**
```javascript
res.status(201).json({ 
    id,
    ...entrada,
    id  // id duplicado
});
```
- Retorna `...entrada` (o que o frontend enviou)
- MAS o banco pode ter campos padrão (created_at, vencimento, etc)
- Frontend recebe de volta o que enviou, não o que foi de fato salvo
- Exemplo: Se frontend envia `grupoParcelamentoId`, o servidor salva no banco, mas não retorna no JSON

**Solução:** Retornar o registro completo após SELECT.

---

### 5. **PUT /api/financeiro/:id não atualiza TODOS os campos**
**Localização:** `server.js` linhas 2571-2590  
**Problema:**
```javascript
const sql = `UPDATE transacoes SET 
    status = ?,
    descricao = ?,
    observacoes = ?,
    data_pagamento = ?,
    grupo_parcelamento_id = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?`;
```
- Só atualiza: status, descricao, observacoes, data_pagamento, grupo_parcelamento_id
- Não permite atualizar: valor, vencimento, tipo, orcamento_id, cliente_id, forma_pagamento, etc
- Resposta do PUT não retorna o registro atualizado completo

**Solução:** Incluir todos os campos ou retornar o registro após UPDATE.

---

### 6. **DELETE /api/financeiro/:id não limpa data.json**
**Localização:** `server.js` linhas 2605-2618  
**Problema:**
```javascript
app.delete('/api/financeiro/:id', (req, res) => {
    const receivedId = req.params.id;
    console.log(`DELETE /api/financeiro/${receivedId} recebido`);

    db.run('DELETE FROM transacoes WHERE id = ?', [receivedId], function(err) {
        // ... deleta do SQLite
    });
});
```
- Deleta do SQLite: ✅
- NÃO atualiza `data.json`: ❌
- Resultado: GET retorna dados corretos, mas `data.json` ainda tem o registro

---

### 7. **CLEANUP /api/financeiro/cleanup não retorna tipo do registro removido**
**Localização:** `server.js` linhas 535-615  
**Problema:**
```javascript
const ids = rows.map(r => r.id).filter(Boolean);
res.json({ deleted: this.changes, backup: path.relative(__dirname, backupPath), removedIds: ids });
```
- Retorna apenas IDs removidos
- Frontend não sabe qual era `tipo` (receber/pagar) de cada ID
- Frontend usa fallback por data (impreciso)
- Se houver registros com mesmo vencimento mas tipos diferentes, pode deletar errado

**Solução:** Retornar `{ id, tipo }` array em vez de só IDs.

---

### 8. **Frontend replaceIdAcrossStores não é confiável**
**Localização:** `modulo-financeiro.html` linhas 768-793  
**Problema:**
```javascript
async replaceIdAcrossStores(oldId, newId) {
    // Varre todos os storageKeys
    // MAS referências cruzadas (ex: parcela.grupoParcelamentoId) NÃO são atualizadas
    // MAS referências para clienteId, orcamentoId NÃO são do mesmo store
```
- Se `grupoParcelamentoId` é um ID local que depois recebe ID do servidor
- Todas as parcelas com `grupoParcelamentoId` antigo não são atualizadas
- Resultado: Parcelas ficam desagrupadas após sincronização

---

### 9. **Frontend Database.add() não aguarda substituição de IDs**
**Localização:** `modulo-financeiro.html` linhas 715-750  
**Problema:**
```javascript
if (resultado && resultado.id) {
    const serverId = String(resultado.id);
    data.id = serverId;
    if (originalLocalId && originalLocalId !== serverId) {
        try {
            await this.replaceIdAcrossStores(originalLocalId, serverId);
        } catch (repErr) { ... }
    }
}
// Salvar localmente (sempre)
const items = this.getAllSync(store);
items.push(data);
```
- `data.id` é atualizado para `serverId`
- `items.push(data)` adiciona com novo ID
- MAS registros antigos com `originalLocalId` podem ainda existir se `replaceIdAcrossStores` falhar
- Resultado: Duplicação de registros com IDs diferentes

---

### 10. **Frontend salvarRecebimento() não valida se sincronização funcionou**
**Localização:** `modulo-financeiro.html` linhas 2330-2350  
**Problema:**
```javascript
const idRetornado = await this.db.add('receber', parcela);
console.log(`[SALVAR RECEBIMENTO] Parcela ID local: ${parcela.id}, ID retornado: ${idRetornado}, syncStatus: ${idRetornado === parcela.id ? 'LOCAL' : 'SINCRONIZADO'}`);
parcelasSalvas.push(parcela);
```
- Se `idRetornado === parcela.id`, significa LOCAL (não sincronizado)
- Mas NÃO há retry/fallback para forçar sincronização
- Se usuário estiver intermitentemente offline, parcela fica local para sempre

---

## 🟡 INCONSISTÊNCIAS DE DESIGN

### 11. **Sem transações no banco**
- POST múltiplas parcelas: cada uma é um INSERT separado
- Se uma falhar, outras já estão no banco
- Sem ROLLBACK

### 12. **Sem validação de descricao obrigatória em POST**
```javascript
if (!entrada.valor || entrada.valor <= 0) {
    // validação OK
}
if (!entrada.vencimento) {
    // validação OK
}
if (!entrada.descricao) {
    // ❌ NÃO existe validação
}
```

### 13. **Sem validação de tipo = "receber" | "pagar" em POST**
- Aceita qualquer string no campo `tipo`
- Depois GET filtra por `tipo IN ('receber', 'pagar')`
- Resultado: registros com tipo inválido são silenciosamente ignorados

### 14. **Campos camelCase vs snake_case inconsistentes**
- Frontend envia: `grupoParcelamentoId`, `orcamentoId`, `clienteId`
- Banco armazena: `grupo_parcelamento_id`, `orcamento_id`, `cliente_id`
- Normalização manual em múltiplos lugares = erro-prone

### 15. **Sem índice em grupo_parcelamento_id**
- Agrupamento é feito no frontend, não no servidor
- Se houver 10K parcelas, frontend tem que processar todas
- Sem índice, GET é lento

---

## 📋 MAPA DE INCONSISTÊNCIAS

| Camada | Problema | Prioridade | Fix |
|--------|----------|-----------|-----|
| Backend | Dual persistence (SQLite + data.json) | 🔴 CRÍTICO | Remover data.json ou sincronizar |
| Backend | GET normalizeFinanceiroRow incompleta | 🔴 CRÍTICO | Aplicar em ambos GET |
| Backend | POST não retorna fields completo | 🔴 CRÍTICO | Retornar registro após INSERT |
| Backend | DELETE não atualiza data.json | 🔴 CRÍTICO | Remover ou sincronizar |
| Backend | PUT não atualiza todos campos | 🟡 ALTO | Incluir todos ou ser explícito |
| Backend | Cleanup não retorna tipo | 🟡 ALTO | Retornar { id, tipo } |
| Frontend | replaceIdAcrossStores incompleta | 🔴 CRÍTICO | Atualizar referências cruzadas |
| Frontend | Sem retry de sync | 🟡 ALTO | Implementar fila de retry |
| Frontend | Sem validação de descricao | 🟡 MÉDIO | Adicionar validação |
| Database | Sem índice em grupo_parcelamento_id | 🟡 MÉDIO | Criar INDEX |

---

## ✅ RECOMENDAÇÃO DE ORDEM DE FIX

1. **Remover data.json completamente** - Remove ambiguidade
2. **Aplicar normalizeFinanceiroRow em todos GET** - Garante consistência
3. **POST retornar registro completo** - Garante frontend recebe o correto
4. **Melhorar replaceIdAcrossStores** - Evita duplicação
5. **Cleanup retornar { id, tipo }** - Evita deleção imprecisa
6. **Adicionar validações** - Impede dados ruins no banco

