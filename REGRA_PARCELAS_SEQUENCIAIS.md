# Implementação: Regra de Liquidação Sequencial de Parcelas

## Resumo
O sistema foi configurado para garantir que **um usuário só possa liquidar uma parcela se a parcela anterior já foi totalmente paga**. Esta é uma regra importante de negócio para evitar lacunas no fluxo de caixa.

## Arquitetura da Solução

### 1. Backend (server.js) - Validação no Servidor
**Arquivo:** `server.js`  
**Rota:** `PUT /api/financeiro/:id`

#### Lógica Implementada:
- Quando uma transação é atualizada com status `'pago'`, o sistema verifica:
  1. Se a transação possui um `numero_parcela` > 1 (ou seja, não é a primeira parcela)
  2. Se sim, busca pela parcela anterior (`numero_parcela - 1`)
  3. Valida se a parcela anterior tem status `'pago'`
  4. Se a parcela anterior **NÃO está paga**, retorna um erro **HTTP 409 (Conflito)** com mensagem descritiva

#### Detalhes Técnicos:
```javascript
// Validação no backend
if ((entrada.status || '').toLowerCase() === 'pago') {
    // Busca a parcela anterior
    // Se encontrar e não estiver paga, retorna:
    // {
    //   error: 'Não é possível liquidar esta parcela. A parcela anterior ainda não foi totalmente paga.',
    //   details: {
    //     mensagem: 'Parcela X deve ser paga antes de liquidar a parcela Y',
    //     parcelaAnterior: X,
    //     statusParcelaAnterior: 'aberto'
    //   }
    // }
}
```

#### Critérios de Agrupamento:
A parcela anterior é identificada por um dos seguintes critérios (em ordem de prioridade):
1. **Grupo de Parcelamento ID** (`grupo_parcelamento_id`) - melhor opção
2. **Orçamento ID** (`orcamento_id`) - segunda opção
3. **Cliente ID** (`cliente_id`) - terceira opção

---

### 2. Frontend (modulo-financeiro.html) - Validação no Cliente
**Arquivo:** `public/modulo-financeiro.html`  
**Função:** `marcarComoPago(id)`

#### Lógica Implementada:
1. Quando o usuário clica em "Marcar como pago", antes de enviar para o servidor:
   - Verifica se a transação possui `numero_parcela` > 1
   - Se sim, busca todas as transações recebidas no localStorage
   - Encontra a parcela anterior usando os mesmos critérios (grupo/orçamento/cliente)
   - Se a parcela anterior não estiver com status `'pago'`, **bloqueia a ação** localmente

2. Se conseguir passar pela validação local:
   - Envia a solicitação de atualização para o servidor
   - O servidor faz uma validação adicional (camada de segurança)
   - Se o servidor retornar erro 409, **reverte as mudanças locais** e exibe mensagem de erro

#### Mensagens de Feedback ao Usuário:
- **Bloqueio Local:** `❌ Não é possível liquidar a parcela X. A parcela X-1 ainda não foi paga!`
- **Bloqueio no Servidor:** `❌ Parcela X deve ser paga antes de liquidar a parcela Y`

---

## Fluxo de Operação

### Cenário 1: Tentar Liquidar Parcela 2 (Parcela 1 não paga)
```
Usuário clica "Marcar como pago" na Parcela 2
    ↓
Frontend verifica se Parcela 1 está paga
    ↓
Parcela 1 status = 'aberto' (não paga)
    ↓
❌ BLOQUEADO no Cliente
Mensagem: "Não é possível liquidar a parcela 2. A parcela 1 ainda não foi paga!"
```

### Cenário 2: Tentar Liquidar Parcela 2 (Parcela 1 paga) - Pular Validação Local
```
Usuário clica "Marcar como pago" na Parcela 2
    ↓
Frontend verifica se Parcela 1 está paga
    ↓
Parcela 1 status = 'pago' ✓
    ↓
Envia PUT /api/financeiro/{id} com status='pago'
    ↓
Backend valida novamente
    ↓
✓ SUCESSO
Parcela 2 marcada como paga
```

### Cenário 3: Ordem Correta (1 → 2 → 3)
```
Liquidar Parcela 1 → ✓ Sucesso
Liquidar Parcela 2 → ✓ Sucesso (Parcela 1 já está paga)
Liquidar Parcela 3 → ✓ Sucesso (Parcelas 1 e 2 já estão pagas)
```

---

## Testes Realizados

Um script de teste automatizado foi criado: `test_parcelas_sequencia.js`

### Resultados dos Testes:
✅ **TESTE 1:** Bloqueio ao tentar liquidar Parcela 2 sem pagar Parcela 1  
✅ **TESTE 2:** Sucesso ao liquidar Parcela 1  
✅ **TESTE 3:** Bloqueio ao tentar liquidar Parcela 3 sem pagar Parcela 2  
✅ **TESTE 4:** Sucesso ao liquidar Parcela 2  
✅ **TESTE 5:** Sucesso ao liquidar Parcela 3 (após Parcelas 1 e 2 pagas)  

### Executar os Testes:
```bash
cd "c:\Users\cicer\Desktop\SISTEMA-NEGO-CAR"
node test_parcelas_sequencia.js
```

---

## Campos Utilizados

A implementação utiliza os seguintes campos da tabela `transacoes`:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INTEGER | Identificador único da transação |
| `numero_parcela` | INTEGER | Número da parcela (1, 2, 3, ...) |
| `total_parcelas` | INTEGER | Quantidade total de parcelas |
| `status` | VARCHAR | Estado (aberto, pago, atrasado, etc.) |
| `grupo_parcelamento_id` | TEXT | ID único para agrupar parcelas (melhor opção) |
| `orcamento_id` | INTEGER | ID do orçamento relacionado (segunda opção) |
| `cliente_id` | INTEGER | ID do cliente (terceira opção) |

---

## Comportamento Esperado

### ✓ Situações Permitidas:
- Liquidar a Parcela 1 (não tem parcela anterior)
- Liquidar a Parcela 2 (quando Parcela 1 está paga)
- Liquidar a Parcela 3 (quando Parcelas 1 e 2 estão pagas)

### ❌ Situações Bloqueadas:
- Tentar liquidar Parcela 2 quando Parcela 1 está aberta
- Tentar liquidar Parcela 3 quando Parcela 2 está aberta
- Tentar liquidar qualquer parcela n > 1 quando a parcela anterior não estiver paga

---

## Tratamento de Erros

### Erro HTTP 409 (Conflito) do Servidor
Quando o servidor detecta uma tentativa de liquidação inválida:

```json
{
  "error": "Não é possível liquidar esta parcela. A parcela anterior ainda não foi totalmente paga.",
  "details": {
    "mensagem": "Parcela 2 deve ser paga antes de liquidar a parcela 3",
    "parcelaAnterior": 2,
    "statusParcelaAnterior": "aberto"
  }
}
```

O frontend:
1. Exibe mensagem de erro personalizada
2. Reverte as mudanças locais
3. Mantém o formulário em estado consistente

---

## Segurança em Camadas

A implementação segue o princípio de **validação em camadas**:

1. **Camada de Apresentação (Frontend):** Validação imediata para feedback rápido
2. **Camada de Negócio (Backend):** Validação definitiva (não confiável em inputs do cliente)
3. **Camada de Persistência (Banco de Dados):** Integridade dos dados

Isso garante que:
- O usuário recebe feedback imediato
- Um cliente malicioso não consegue burlar a validação
- Os dados no banco de dados permanecem consistentes

---

## Próximos Passos (Opcional)

1. **Adicionar interface de visualização:** Mostrar status de todas as parcelas em uma lista
2. **Adicionar avisos:** Exibir quais parcelas estão pendentes antes de liquidar
3. **Adicionar relatórios:** Gerar relatórios de parcelas pendentes/pagas
4. **Integração com WhatsApp:** Enviar avisos quando uma parcela é paga (para cobrar a próxima)

---

## Arquivos Modificados

1. ✏️ `server.js` - Linha 2613-2715 (Endpoint PUT /api/financeiro/:id)
2. ✏️ `public/modulo-financeiro.html` - Linha 2428-2530 (Função marcarComoPago)
3. ✨ `test_parcelas_sequencia.js` - Novo arquivo com suite de testes

---

**Data de Implementação:** 27 de janeiro de 2026  
**Status:** ✅ Testado e Funcionando
