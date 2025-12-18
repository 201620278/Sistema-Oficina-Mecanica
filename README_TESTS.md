Instruções rápidas de teste - Sistema Financeiro

Objetivo
- Executar teste básico que valida criação (POST), listagem (GET), remoção (DELETE) e cleanup (admin) do módulo financeiro.

Arquivos
- scripts/test_basic_financeiro.js: script Node que cria, lista, deleta e testa cleanup.

Pré-requisitos
- Node.js instalado
- Projeto inicializado (dependências do projeto se houver)

Passos
1. Iniciar o servidor local (na máquina onde o DB ficará):

```powershell
node server.js
```

2. Em outro terminal, executar o script de teste simples:

```powershell
node scripts/test_basic_financeiro.js
```

O script executa:
- POST /api/financeiro (cria item)
- GET /api/financeiro (lista)
- DELETE /api/financeiro/:id (remove o item criado)
- POSTs dois registros antigos, faz login admin e chama POST /api/financeiro/cleanup
- Verifica que os itens foram removidos

Resultados esperados
- Saída com status 201 para POSTs, 200 para GET/DELETE/CLEANUP
- `removedItems` retornado pelo cleanup contendo os ids removidos

Notas
- O servidor foi projetado para rodar na mesma máquina do banco (localhost). O script assume `http://localhost:3000`.
- Se o servidor estiver offline, os lançamentos criados pelo front-end vão para `localStorage` e `financeiro-sync-queue`; o sync será tentado quando o servidor voltar.

Se quiser, posso adicionar um `npm script` para facilitar a execução (ex: `npm run test:financeiro`).
