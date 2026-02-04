# Como Testar a Regra de Liquidação Sequencial de Parcelas

## Teste Rápido (Recomendado)

### 1. Executar Script de Teste Automatizado
```bash
cd "c:\Users\cicer\Desktop\SISTEMA-NEGO-CAR"
node test_parcelas_sequencia.js
```

Este script irá:
- Criar 3 parcelas de teste automaticamente
- Testar todos os cenários de bloqueio e sucesso
- Exibir resultado detalhado de cada teste

**Resultado esperado:** Todos os 5 testes com ✓

---

## Teste Manual na Interface

### 1. Iniciar o Servidor
```bash
cd "c:\Users\cicer\Desktop\SISTEMA-NEGO-CAR"
npm start
# ou
node server.js
```

### 2. Acessar a Interface
Abra seu navegador e acesse:
```
http://localhost:3000/public/modulo-financeiro.html#receber
```

### 3. Criar Parcelas de Teste

#### Opção A: Criar pelo Módulo Financeiro (Manual)
1. Na seção **"Contas a Receber"** (abas no topo)
2. Clique em **"Adicionar Duplicata"**
3. Preencha os dados:
   - **Cliente:** Escolha um cliente
   - **Descrição:** "Teste - Parcela 1 de 3"
   - **Valor:** 1000.00
   - **Vencimento:** Data futura (ex: 01/02/2026)
   - **Clique:** "Adicionar à tabela"
4. Repita para:
   - "Teste - Parcela 2 de 3" 
   - "Teste - Parcela 3 de 3"

#### Opção B: Usar SQL Direto (mais rápido)
```bash
# Abra o SQLite em outro terminal
sqlite3 database.db

# Execute (substitua os dados conforme necessário):
INSERT INTO transacoes 
(descricao, tipo, valor, numero_parcela, total_parcelas, status, vencimento, data, cliente_id, criado_em)
VALUES 
('Manual Test - Parcela 1', 'receber', 1000, 1, 3, 'aberto', '2026-02-01', CURRENT_DATE, 1, CURRENT_TIMESTAMP),
('Manual Test - Parcela 2', 'receber', 1000, 2, 3, 'aberto', '2026-03-01', CURRENT_DATE, 1, CURRENT_TIMESTAMP),
('Manual Test - Parcela 3', 'receber', 1000, 3, 3, 'aberto', '2026-04-01', CURRENT_DATE, 1, CURRENT_TIMESTAMP);
```

### 4. Testar o Comportamento

#### 🧪 Teste 1: Bloquear Parcela 2 (sem Parcela 1 paga)
1. Na tabela de "Contas a Receber", localize a **Parcela 2**
2. Clique no botão **"Marcar como pago"** (verde)
3. **Resultado Esperado:** ❌ Mensagem de erro aparecerá
   ```
   ❌ Não é possível liquidar a parcela 2. A parcela 1 ainda não foi paga!
   ```

#### 🧪 Teste 2: Liquidar Parcela 1 (permitido)
1. Localize a **Parcela 1**
2. Clique em **"Marcar como pago"**
3. **Resultado Esperado:** ✅ Parcela marcada como paga
4. Status muda para **"pago"** com data de pagamento

#### 🧪 Teste 3: Bloquear Parcela 3 (sem Parcela 2 paga)
1. Localize a **Parcela 3**
2. Clique em **"Marcar como pago"**
3. **Resultado Esperado:** ❌ Mensagem de erro
   ```
   ❌ Não é possível liquidar a parcela 3. A parcela 2 ainda não foi paga!
   ```

#### 🧪 Teste 4: Liquidar Parcela 2 (agora permitido)
1. Localize a **Parcela 2**
2. Clique em **"Marcar como pago"**
3. **Resultado Esperado:** ✅ Parcela 2 marcada como paga

#### 🧪 Teste 5: Liquidar Parcela 3 (agora permitido)
1. Localize a **Parcela 3**
2. Clique em **"Marcar como pago"**
3. **Resultado Esperado:** ✅ Parcela 3 marcada como paga

### 5. Verificar o Console do Navegador

Abra **DevTools** (F12 ou Ctrl+Shift+I) e vá para **Console**:

Você verá logs como:
```javascript
// Bloqueio (Frontend)
"[DELETE] ID '...' detectado como ID local..."

// Sucesso
"PUT /api/financeiro/123 - OK"
```

---

## Troubleshooting

### Problema: Mensagem de erro não aparece

**Solução 1:** Verifique se tem parcelas com `numero_parcela` definido
```sql
SELECT id, numero_parcela, status FROM transacoes LIMIT 5;
```

**Solução 2:** Limpe o cache do navegador
- Pressione Ctrl+Shift+Delete
- Selecione "Cookies e dados de site armazenados"
- Clique "Limpar"

**Solução 3:** Abra o DevTools e veja se há erros
- Pressione F12
- Clique na aba "Console"
- Procure por mensagens de erro em vermelho

### Problema: Servidor retorna erro 500

**Solução:** Verifique o console do servidor
```bash
# Você verá logs como:
# Erro ao atualizar no servidor...
# Erro 409: Parcela anterior não paga
```

---

## Validação da Implementação

A implementação está **correta** quando:

✅ **Parcela 1:** Sempre permite liquidar (primeira parcela)
✅ **Parcela 2:** Bloqueia se Parcela 1 não está paga
✅ **Parcela 3:** Bloqueia se Parcela 2 não está paga
✅ **Mensagens:** Claras e informativas
✅ **Reversão:** Estado local reverte em caso de erro no servidor

---

## Arquivos Relevantes

| Arquivo | Modificação |
|---------|------------|
| `server.js` | Validação no backend (PUT /api/financeiro/:id) |
| `public/modulo-financeiro.html` | Validação no frontend (marcarComoPago) |
| `test_parcelas_sequencia.js` | Suite de testes automatizados |
| `REGRA_PARCELAS_SEQUENCIAIS.md` | Documentação técnica completa |
| `RESUMO_IMPLEMENTACAO.txt` | Resumo das mudanças |

---

## Perguntas Frequentes

### P: Por que bloqueia em duas camadas?
**R:** 
- **Frontend:** Feedback imediato ao usuário
- **Backend:** Segurança (cliente pode ser manipulado com DevTools)

### P: E se a Parcela 1 for excluída?
**R:** A validação procura apenas por parcelas pagas. Se Parcela 1 for deletada, Parcela 2 não conseguirá ser liquidada.

### P: E se usar um grupo de parcelamento diferente?
**R:** O sistema usa `grupo_parcelamento_id` para agrupar. Parcelas com grupos diferentes não se validam mutuamente.

### P: Funciona offline?
**R:** 
- **Validação local:** Funciona offline
- **Sincronização com servidor:** Só funciona online
- **Dados:** Salvos localmente e sincronizados quando online

---

## Próximas Etapas (Opcional)

1. **Adicionar avisos:** Mostrar qual parcela está pendente
2. **Adicionar relatório:** "Parcelas Pendentes" seção no dashboard
3. **Integração WhatsApp:** Notificar cliente quando parcela for paga
4. **Histórico:** Registrar quem pagou e quando

---

**Data de Atualização:** 27 de janeiro de 2026  
**Status:** ✅ Pronto para teste
