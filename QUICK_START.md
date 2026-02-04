# 🚀 QUICK START - Comandos Rápidos

## 1️⃣ Executar Testes (Recomendado - 30 segundos)
```bash
cd "c:\Users\cicer\Desktop\SISTEMA-NEGO-CAR"
node test_parcelas_sequencia.js
```

**Resultado Esperado:**
```
✓ TESTE 1: Bloqueado como esperado
✓ TESTE 2: Sucesso como esperado
✓ TESTE 3: Bloqueado como esperado
✓ TESTE 4: Sucesso como esperado
✓ TESTE 5: Sucesso como esperado

Estado final das parcelas:
  ✓ Parcela 1: pago
  ✓ Parcela 2: pago
  ✓ Parcela 3: pago
```

---

## 2️⃣ Iniciar o Servidor
```bash
npm start
# ou
node server.js
```

**Resultado Esperado:**
```
Servidor rodando em http://localhost:3000
Banco de dados local: /path/to/database.db
```

---

## 3️⃣ Acessar a Interface
```
http://localhost:3000/public/modulo-financeiro.html#receber
```

---

## 4️⃣ Abrir Banco de Dados (SQLite)
```bash
sqlite3 database.db
```

**Ver parcelas:**
```sql
SELECT id, numero_parcela, status FROM transacoes 
WHERE numero_parcela IS NOT NULL 
ORDER BY numero_parcela;
```

---

## 📂 Arquivos Principais

| Arquivo | Descrição |
|---------|-----------|
| `server.js` | Backend com validação (linha 2613) |
| `public/modulo-financeiro.html` | Frontend (linha 2428) |
| `test_parcelas_sequencia.js` | Testes automatizados |

---

## 📖 Documentação Rápida

| Documento | Conteúdo |
|-----------|----------|
| `CHECKLIST_IMPLEMENTACAO.txt` | Este checklist visual |
| `README_PARCELAS.txt` | Resumo executivo |
| `REGRA_PARCELAS_SEQUENCIAIS.md` | Documentação técnica |
| `COMO_TESTAR.md` | Guia de testes manual |

---

## ✅ Validação Rápida

### Teste 1: Bloquear Parcela 2
```bash
# Frontend bloqueia antes de enviar
❌ "Parcela 1 ainda não foi paga!"
```

### Teste 2: Liquidar Parcela 1
```bash
# Sempre permitido (é a primeira)
✅ "Parcela 1 marcada como paga"
```

### Teste 3: Liquidar Parcela 2
```bash
# Permitido (Parcela 1 já está paga)
✅ "Parcela 2 marcada como paga"
```

---

## 🔍 Verificar Implementação

### Backend (server.js)
```bash
grep -n "numero_parcela > 1" server.js
# Deve retornar a linha onde a validação está
```

### Frontend (modulo-financeiro.html)
```bash
grep -n "numeroParcela && numeroParcela > 1" public/modulo-financeiro.html
# Deve retornar a linha onde a validação está
```

---

## 🐛 Troubleshooting Rápido

### Teste não passa
```bash
# Limpar dados antigos
sqlite3 database.db "DELETE FROM transacoes WHERE grupo_parcelamento_id LIKE 'teste-%'"
# Rodar novamente
node test_parcelas_sequencia.js
```

### Servidor não inicia
```bash
# Verificar porta 3000
netstat -ano | findstr ":3000"
# Matar processo se necessário
taskkill /PID <PID> /F
```

### Banco de dados travado
```bash
# Verificar integridade
sqlite3 database.db "PRAGMA integrity_check"
```

---

## 📊 Status

| Item | Status |
|------|--------|
| Backend | ✅ Implementado |
| Frontend | ✅ Implementado |
| Testes | ✅ Passando |
| Documentação | ✅ Completa |
| Pronto | ✅ SIM |

---

## 🎯 Próximos Passos

1. ✅ Executar testes: `node test_parcelas_sequencia.js`
2. ✅ Iniciar servidor: `npm start`
3. ✅ Acessar interface: `http://localhost:3000`
4. ✅ Criar parcelas de teste
5. ✅ Testar bloqueio e sucesso

---

## 💬 Resumo

A regra de negócio foi **implementada com sucesso**. 

Um usuário **não consegue liquidar uma parcela** se a **parcela anterior não foi paga**.

**Validação em dupla camada:**
- Frontend: Feedback imediato
- Backend: Segurança final

**100% testado e documentado** ✅

---

## 📞 Suporte

Para dúvidas, consulte:
- `REGRA_PARCELAS_SEQUENCIAIS.md` - Técnico
- `COMO_TESTAR.md` - Prático
- `README_PARCELAS.txt` - Visão Geral

---

**Data:** 27 de janeiro de 2026  
**Status:** 🟢 Pronto para Produção
