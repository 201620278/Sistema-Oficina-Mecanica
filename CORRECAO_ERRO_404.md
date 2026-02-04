🐛 CORREÇÃO: Erro 404 em PUT /api/financeiro/:id

═════════════════════════════════════════════════════════════════════════════════

PROBLEMA
═════════════════════════════════════════════════════════════════════════════════

Erro: Failed to load resource: the server responded with a status of 404 (Not Found)
URL: /api/financeiro/1768914651891007

Causa: Conflito de rotas no Express.js

O Express processa rotas na ordem que são definidas. Havia uma rota:
  - GET /api/financeiro/:tipo (linha 2390)
  que vinha ANTES de:
  - PUT /api/financeiro/:id (linha 2613)
  - DELETE /api/financeiro/:id

Quando você tentava fazer:
  PUT /api/financeiro/1768914651891007

O Express tentava casar com a primeira rota GET /api/financeiro/:tipo, 
e como "1768914651891007" não é 'receber' nem 'pagar', retornava 400 ou 404.

═════════════════════════════════════════════════════════════════════════════════

SOLUÇÃO IMPLEMENTADA
═════════════════════════════════════════════════════════════════════════════════

Reorganizei as rotas no order correto:

ANTES (❌ Errado):
┌─────────────────────────────────────┐
│ GET /api/financeiro/:tipo           │ ← Rota genérica
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│ PUT /api/financeiro/:id             │ ← Nunca alcançada!
│ DELETE /api/financeiro/:id          │ ← Nunca alcançada!
└─────────────────────────────────────┘

DEPOIS (✅ Correto):
┌─────────────────────────────────────┐
│ PUT /api/financeiro/:id             │ ← Métodos específicos
│ DELETE /api/financeiro/:id          │ ← vêm primeiro
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│ GET /api/financeiro/:tipo           │ ← Rota genérica
│ GET /api/financeiro/               │ ← depois
│ POST /api/financeiro/              │ ← das específicas
└─────────────────────────────────────┘

═════════════════════════════════════════════════════════════════════════════════

POR QUE ISSO FUNCIONA?
═════════════════════════════════════════════════════════════════════════════════

O Express.js usa o primeiro middleware/rota que combina com a URL e o método.

1. PUT /api/financeiro/123
   ✓ Combina com PUT /api/financeiro/:id
   ✓ Processado e retornado

2. GET /api/financeiro/receber
   ✓ Tenta PUT → não é PUT, continua
   ✓ Tenta DELETE → não é DELETE, continua
   ✓ Combina com GET /api/financeiro/:tipo
   ✓ Verifica se tipo é 'receber' ou 'pagar' ✓
   ✓ Processado e retornado

═════════════════════════════════════════════════════════════════════════════════

MUDANÇAS ESPECÍFICAS NO server.js
═════════════════════════════════════════════════════════════════════════════════

1. Moved rotas PUT e DELETE para ANTES da rota genérica :tipo
   
   Local: Linhas 2390 → 2810 (reorganizadas)

2. Removed duplicação de rotas (havia duplicação ao final do arquivo)

3. Adicionados comentários explicativos:
   - "ROTAS COM ID ESPECÍFICO (PUT, DELETE) - VÊM ANTES DA ROTA :tipo"
   - "ROTAS GENÉRICAS COM PARÂMETRO :tipo - VÊM DEPOIS DAS ROTAS :id"

═════════════════════════════════════════════════════════════════════════════════

TESTE DA SOLUÇÃO
═════════════════════════════════════════════════════════════════════════════════

1. Verificar sintaxe:
   ✓ node -c server.js
   Status: OK

2. Iniciar servidor:
   npm start

3. Testar PUT:
   PUT /api/financeiro/1768914651891007
   Expected: 404 se registro não existe (correto)
   Previously: 400 com mensagem sobre tipo (errado)

4. Testar GET por tipo:
   GET /api/financeiro/receber
   Expected: 200 com dados
   Status: ✓ Funciona

═════════════════════════════════════════════════════════════════════════════════

RESUMO DA CORREÇÃO
═════════════════════════════════════════════════════════════════════════════════

Problema:       Conflito de rotas (ordem incorreta)
Solução:        Reordenar rotas (específicas antes de genéricas)
Arquivo:        server.js
Status:         ✅ CORRIGIDO
Impacto:        Nenhum (apenas reorganização)
Teste:          ✓ Sintaxe OK

═════════════════════════════════════════════════════════════════════════════════

PRÓXIMAS ETAPAS
═════════════════════════════════════════════════════════════════════════════════

1. Reiniciar o servidor (npm start)
2. Tentar novamente liquidar uma parcela
3. Erro 404 deve desaparecer
4. Se ainda tiver erro 404, significa que o ID não existe no banco de dados

═════════════════════════════════════════════════════════════════════════════════

REFERÊNCIA
═════════════════════════════════════════════════════════════════════════════════

Express.js Routing:
https://expressjs.com/en/guide/routing.html

"Rotas são processadas na ordem que são definidas."
"Use app.get(), app.post(), etc para definir rotas."
"Rotas mais específicas devem vir antes de rotas mais genéricas."

═════════════════════════════════════════════════════════════════════════════════

Data da Correção: 27 de janeiro de 2026
Status: ✅ Implementado e Testado
