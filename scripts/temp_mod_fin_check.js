// Arquivo temporário reduzido: apenas checagem de sintaxe
class Database { constructor(){ this.storageKeys={clientes:'clientes',receber:'financeiro-receber',pagar:'financeiro-pagar'} } async init(){return Promise.resolve()} getAllSync(s){ try{ const v=localStorage.getItem(this.storageKeys[s]); return v?JSON.parse(v):[] }catch(e){return[]} } async getAll(s){ if(s==='receber'||s==='pagar'){ try{ const r=await fetch('/api/financeiro'); if(!r.ok) throw new Error('fetch'); const j=await r.json(); return (j||[]).filter(x=>String((x.tipo||'')).toLowerCase()===s) }catch(e){ return this.getAllSync(s) } } return this.getAllSync(s) } async get(s,id){ const a=this.getAllSync(s); return a.find(x=>String(x.id)===String(id))||null } async add(s,d){ if(s==='receber'||s==='pagar'){ if(!navigator.onLine) throw new Error('offline'); const resp=await fetch('/api/financeiro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({tipo:s},d))}); if(!resp.ok) throw new Error('post'); const jj=await resp.json(); return jj.id||null } const items=this.getAllSync(s); items.push(d); localStorage.setItem(this.storageKeys[s],JSON.stringify(items)); return d.id } async put(s,d){ return d.id } async delete(s,id){ return Promise.resolve() } }

class SyncManager { updateStatus(){ const i=(typeof document!=='undefined' && document.getElementById)?document.getElementById('status-indicator'):null; const t=(typeof document!=='undefined' && document.getElementById)?document.getElementById('status-text'):null; if(i) i.className='status-indicator'; if(t) t.textContent='Online'; } }

class WhatsAppManager { gerarLinkWeb(t,m){ return 'https://wa.me/55'+(t||'')+'?text='+encodeURIComponent(m) } }

class UIManager { constructor(){ this.db=new Database(); this.syncManager=new SyncManager(); this.whatsappManager=new WhatsAppManager() } async init(){ await this.db.init() } }

const ui=new UIManager(); const syncManager=new SyncManager(); const whatsappManager=new WhatsAppManager(); syncManager.updateStatus();

    async delete(store, key) {
        const keyStorage = this.storageKeys[store];
        if (!keyStorage) throw new Error(`Store ${store} não encontrado`);

        if (store === 'receber' || store === 'pagar') {
            if (!navigator.onLine) throw new Error('Offline: não é possível deletar registro no servidor');
            const endpoint = `/api/financeiro/${key}`;
            try {
                const resp = await fetch(endpoint, { method: 'DELETE' });
                if (resp.ok) return Promise.resolve();
                if (resp.status === 404) return Promise.resolve();
                const txt = await resp.text().catch(()=>null);
                throw new Error(`DELETE falhou: ${resp.status} ${txt}`);
            } catch (err) {
                console.error('Erro ao deletar financeiro no servidor:', err);
                throw err;
            }
        }

        // non-financeiro: remove local
        const items = this.getAllSync(store);
        const filtered = items.filter(item => String(item.id) !== String(key));
        localStorage.setItem(keyStorage, JSON.stringify(filtered));
        return Promise.resolve();
    }


    // Arquivo temporário reduzido: apenas checagem de sintaxe
    async replaceIdAcrossStores(oldId, newId) {
        if (!oldId || !newId) return Promise.resolve();
        try {
            const keys = Object.values(this.storageKeys);
            const replaceInObject = (obj) => {
                if (!obj || typeof obj !== 'object') return false;
                let changed = false;
                const walk = (value, parent, k) => {
                    if (value === null || value === undefined) return;
                    if (typeof value === 'string' || typeof value === 'number') {
                        if (String(value) === String(oldId)) {
                            parent[k] = String(newId);
                            changed = true;
                        }
                        return;
                    }
                    if (Array.isArray(value)) {
                        for (let i = 0; i < value.length; i++) walk(value[i], value, i);
                        return;
                    }
                    if (typeof value === 'object') {
                        Object.keys(value).forEach(kk => walk(value[kk], value, kk));
                        return;
                    }
                };
                Object.keys(obj).forEach(k => walk(obj[k], obj, k));
                return changed;
            };
            for (const k of keys) {
                try {
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    let arr = JSON.parse(raw);
                    let changedAny = false;
                    if (Array.isArray(arr)) {
                        for (let i = 0; i < arr.length; i++) {
                            const it = arr[i];
                            try { if (replaceInObject(it)) changedAny = true; } catch (e) {}
                        }
                    } else if (typeof arr === 'object') {
                        if (replaceInObject(arr)) changedAny = true;
                    }
                    if (changedAny) localStorage.setItem(k, JSON.stringify(arr));
                } catch (e) {}
            }
        } catch (e) {
            console.warn('replaceIdAcrossStores falhou:', e);
        }
        return Promise.resolve();
    }
    // Métodos utilitários que usam getAll (já server-first para financeiro)
    async getTotalReceberHoje() {
        const hoje = new Date().toISOString().split('T')[0];
        const receber = await this.getAll('receber', 'vencimento', hoje);
        return receber.filter(r => r.status === 'aberto').reduce((total, r) => total + (r.valor || 0), 0);
    }

    async getTotalPagarHoje() {
        const hoje = new Date().toISOString().split('T')[0];
        const pagar = await this.getAll('pagar', 'vencimento', hoje);
        return pagar.filter(p => p.status === 'aberto').reduce((total, p) => total + (p.valor || 0), 0);
    }

    async getVencimentosHoje() {
        const hoje = new Date().toISOString().split('T')[0];
        const receber = await this.getAll('receber', 'vencimento', hoje);
        const pagar = await this.getAll('pagar', 'vencimento', hoje);
        return { receber: receber.filter(r => r.status === 'aberto'), pagar: pagar.filter(p => p.status === 'aberto') };
    }

    async getUltimosRecebimentos() {
        const receber = await this.getAll('receber');
        return receber.filter(r => {
            const st = (r.status || '').toString().toLowerCase();
            const hasPartial = (st.indexOf('parcial') !== -1) || (st.indexOf('pgto') !== -1 && st.indexOf('parcial') !== -1);
            return r.status === 'pago' || hasPartial || (r.valorPago || r.valor_pago);
        }).sort((a,b)=>{ const da=new Date(a.dataPagamento||a.ultimoPagamentoParcial||0).getTime()||0; const db=new Date(b.dataPagamento||b.ultimoPagamentoParcial||0).getTime()||0; return db-da; }).slice(0,5);
    }

    async getUltimosPagamentos() {
        const pagar = await this.getAll('pagar');
        return pagar.filter(p => {
            const st = (p.status || '').toString().toLowerCase();
            const hasPartial = (st.indexOf('parcial') !== -1) || (st.indexOf('pgto') !== -1 && st.indexOf('parcial') !== -1);
            return p.status === 'pago' || hasPartial || (p.valorPago || p.valor_pago);
        }).sort((a,b)=>{ const da=new Date(a.dataPagamento||a.ultimoPagamentoParcial||0).getTime()||0; const db=new Date(b.dataPagamento||b.ultimoPagamentoParcial||0).getTime()||0; return db-da; }).slice(0,5);
    }

    async getFluxoCaixa7Dias() {
        const hoje = new Date();
        const fluxo = [];
        for (let i=0;i<7;i++){
            const data = new Date(hoje); data.setDate(hoje.getDate()+i); const dataStr = data.toISOString().split('T')[0];
            const receber = await this.getAll('receber','vencimento',dataStr);
            const pagar = await this.getAll('pagar','vencimento',dataStr);
            const totalReceber = receber.filter(r=>r.status==='aberto').reduce((s,r)=>s+(r.valor||0),0);
            const totalPagar = pagar.filter(p=>p.status==='aberto').reduce((s,p)=>s+(p.valor||0),0);
            fluxo.push({ data: dataStr, receber: totalReceber, pagar: totalPagar, saldo: totalReceber-totalPagar });
        }
        return fluxo;
    }

    async buscarClientesPorNome(nome) {
        const clientes = this.getAllSync('clientes');
        if (!nome) return clientes;
        return clientes.filter(c => c.nome && c.nome.toLowerCase().includes(nome.toLowerCase()));
    }

    async getOrcamentosAprovadosPorCliente(clienteId) {
        const orcamentosRaw = localStorage.getItem('orcamentos');
        try {
            const orcamentos = orcamentosRaw ? JSON.parse(orcamentosRaw) : [];
            return orcamentos.filter(o => String(o.clienteId) === String(clienteId) && o.aprovado);
        } catch (e) {
            return [];
        }
    }
}

class SyncManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.updateStatus();
    }

    updateStatus() {
        const indicator = document.getElementById('status-indicator');
        const text = document.getElementById('status-text');
        
        if (this.isOnline) {
            indicator.className = 'status-indicator';
            text.textContent = 'Online';
        } else {
            indicator.className = 'status-indicator offline';
            text.textContent = 'Offline';
        }
    }

    // trySync removed in server-first mode
}

// WhatsAppManager, UIManager and outras funções foram omitidas na checagem por brevidade
// mas a versão completa do script foi extraída para o HTML. Aqui mantemos apenas a
// parte de Database e SyncManager para validação de sintaxe principal.

// Para checar toda a página completa, extraia o <script> inteiro do HTML.

// Nota: este arquivo é somente para `node --check` local; não é usado em produção.

module.exports = { Database, SyncManager };
    async delete(store, key) {
        // Se for receber ou pagar, sincronizar com servidor
        if ((store === 'receber' || store === 'pagar') && key) {
            // Heurística para detectar se o registro local está sincronizado com servidor
            const keyStr = String(key);
            // Buscar item localmente para verificar flags de sincronização
            const itemsNow = this.getAllSync(store);
            const localItem = (itemsNow || []).find(item => String(item.id) === String(keyStr));
            const isServerLike = localItem && localItem._synced === true && localItem.idServidor;

            console.log(`[DELETE] store=${store}, key=${keyStr}, isServerLike=${!!isServerLike}`, localItem ? { _synced: localItem._synced, idServidor: localItem.idServidor } : null);

            if (!isServerLike) {
                console.warn(`[DELETE] ID '${keyStr}' detectado como ID local (não sincronizado com servidor); deletando apenas localmente`);
                // Deletar localmente
                const items = this.getAllSync(store);
                const filtered = items.filter(item => String(item.id) !== String(keyStr));
                localStorage.setItem(this.storageKeys[store], JSON.stringify(filtered));
                console.log(`[DELETE] Removido localmente: ${store} ID ${keyStr} (${items.length} → ${filtered.length} itens)`);
                return Promise.resolve();
            }

            // Usar idServidor como identificador no servidor
            const endpoint = `/api/financeiro/${localItem.idServidor}`;
            if (!navigator.onLine) {
                throw new Error('Offline: não é possível deletar registro no servidor');
            }
            try {
                console.log(`[DELETE] Chamando DELETE remoto para ${endpoint}`);
                const response = await fetch(endpoint, { method: 'DELETE' });
                if (response.ok) {
                    // Remover localmente apenas após confirmação do servidor
                    const items = this.getAllSync(store);
                    const filtered = items.filter(item => String(item.id) !== String(keyStr));
                    localStorage.setItem(this.storageKeys[store], JSON.stringify(filtered));
                    console.log(`[DELETE] Removido no servidor e localmente: ${store} ID ${keyStr}`);
                    return Promise.resolve();
                }
                if (response.status === 404) {
                    // Já removido no servidor: remover local e resolver
                    console.warn(`[DELETE] Registro ${keyStr} não existe no servidor. Removendo localmente.`);
                    const items = this.getAllSync(store);
                    const filtered = items.filter(item => String(item.id) !== String(keyStr));
                    localStorage.setItem(this.storageKeys[store], JSON.stringify(filtered));
                    return Promise.resolve();
                }
                const txt = await response.text().catch(()=>null);
                throw new Error(`DELETE falhou: ${response.status} ${txt}`);
            } catch (error) {
                console.error(`[DELETE] Erro ao deletar ${store}:`, error);
                throw error;
            }
        }
    }

    // Métodos específicos
    async gerarId() {
        return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }

    async getTotalReceberHoje() {
        const hoje = new Date().toISOString().split('T')[0];
        const receber = await this.getAll('receber', 'vencimento', hoje);
        return receber
            .filter(r => r.status === 'aberto')
            .reduce((total, r) => total + (r.valor || 0), 0);
    }

    async getTotalPagarHoje() {
        const hoje = new Date().toISOString().split('T')[0];
        const pagar = await this.getAll('pagar', 'vencimento', hoje);
        return pagar
            .filter(p => p.status === 'aberto')
            .reduce((total, p) => total + (p.valor || 0), 0);
    }

    async getVencimentosHoje() {
        const hoje = new Date().toISOString().split('T')[0];
        const receber = await this.getAll('receber', 'vencimento', hoje);
        const pagar = await this.getAll('pagar', 'vencimento', hoje);
        
        return {
            receber: receber.filter(r => r.status === 'aberto'),
            pagar: pagar.filter(p => p.status === 'aberto')
        };
    }

    async getUltimosRecebimentos() {
        const receber = await this.getAll('receber');
        return receber
            .filter(r => {
                const st = (r.status || '').toString().toLowerCase();
                const hasPartial = (st.indexOf('parcial') !== -1) || (st.indexOf('pgto') !== -1 && st.indexOf('parcial') !== -1);
                return r.status === 'pago' || hasPartial || (r.valorPago || r.valor_pago);
            })
            .sort((a, b) => {
                const da = new Date(a.dataPagamento || a.ultimoPagamentoParcial || 0).getTime() || 0;
                const dbt = new Date(b.dataPagamento || b.ultimoPagamentoParcial || 0).getTime() || 0;
                return dbt - da;
            })
            .slice(0, 5);
    }

    async getUltimosPagamentos() {
        const pagar = await this.getAll('pagar');
        return pagar
            .filter(p => {
                const st = (p.status || '').toString().toLowerCase();
                const hasPartial = (st.indexOf('parcial') !== -1) || (st.indexOf('pgto') !== -1 && st.indexOf('parcial') !== -1);
                return p.status === 'pago' || hasPartial || (p.valorPago || p.valor_pago);
            })
            .sort((a, b) => {
                const da = new Date(a.dataPagamento || a.ultimoPagamentoParcial || 0).getTime() || 0;
                const dbt = new Date(b.dataPagamento || b.ultimoPagamentoParcial || 0).getTime() || 0;
                return dbt - da;
            })
            .slice(0, 5);
    }

    async getFluxoCaixa7Dias() {
        const hoje = new Date();
        const fluxo = [];
        
        for (let i = 0; i < 7; i++) {
            const data = new Date(hoje);
            data.setDate(hoje.getDate() + i);
            const dataStr = data.toISOString().split('T')[0];
            
            const receber = await this.getAll('receber', 'vencimento', dataStr);
            const pagar = await this.getAll('pagar', 'vencimento', dataStr);
            
            const totalReceber = receber
                .filter(r => r.status === 'aberto')
                .reduce((sum, r) => sum + (r.valor || 0), 0);
                
            const totalPagar = pagar
                .filter(p => p.status === 'aberto')
                .reduce((sum, p) => sum + (p.valor || 0), 0);
            
            fluxo.push({
                data: dataStr,
                receber: totalReceber,
                pagar: totalPagar,
                saldo: totalReceber - totalPagar
            });
        }
        
        return fluxo;
    }

    async buscarClientesPorNome(nome) {
        // Buscar clientes do localStorage compartilhado com index.html
        const clientes = this.getAllSync('clientes');
        console.log('Total de clientes no localStorage:', clientes.length);
        
        if (!nome) return Promise.resolve(clientes);
        
        const clientesFiltrados = clientes.filter(cliente => 
            cliente.nome && cliente.nome.toLowerCase().includes(nome.toLowerCase())
        );
        
        console.log('Clientes encontrados para:', nome, 'Total:', clientesFiltrados.length);
        
        return Promise.resolve(clientesFiltrados);
    }

    async getOrcamentosAprovadosPorCliente(clienteId) {
        // Forçar recarregamento dos dados do localStorage (pode ter sido atualizado no index.html)
        const orcamentosRaw = localStorage.getItem('orcamentos');
        const ordensServicoRaw = localStorage.getItem('ordensServico');
        
        let orcamentos = [];
        let ordensServico = [];
        
        try {
            orcamentos = orcamentosRaw ? JSON.parse(orcamentosRaw) : [];
            ordensServico = ordensServicoRaw ? JSON.parse(ordensServicoRaw) : [];
        } catch (error) {
            console.error('Erro ao parsear dados do localStorage:', error);
            return Promise.resolve([]);
        }
        
        // Normalizar clienteId para comparação
        const clienteIdNormalizado = this.normalizarId(clienteId);
        
        console.log('=== BUSCA DE ORÇAMENTOS ===');
        console.log('Cliente ID:', clienteId, 'Normalizado:', clienteIdNormalizado);
        console.log('Total de orçamentos no localStorage:', orcamentos.length);
        console.log('Total de OS no localStorage:', ordensServico.length);
        
        // Debug: mostrar todos os orçamentos
        console.log('Todos os orçamentos:', orcamentos.map(o => ({
            id: o.id,
            numero: o.numero,
            clienteId: o.clienteId || o.cliente_id,
            status: o.status
        })));
        
        // Debug: mostrar todas as OS
        console.log('Todas as OS:', ordensServico.map(os => ({
            id: os.id,
            numero: os.numero,
            orcamentoId: os.orcamentoId || os.orcamento_id,
            status: os.status
        })));
        
        if (orcamentos.length === 0) {
            console.warn('⚠️ Nenhum orçamento encontrado no localStorage!');
            return Promise.resolve([]);
        }
        
        // Filtrar orçamentos aprovados e finalizados do cliente
        // Verificar tanto clienteId quanto cliente_id (formato do servidor)
        const orcamentosAprovadosEFinalizados = orcamentos.filter(orcamento => {
            const orcClienteId = this.normalizarId(orcamento.clienteId);
            const orcClienteIdAlt = this.normalizarId(orcamento.cliente_id);
            // Aceitar orçamentos aprovados OU finalizados
            const statusOk = orcamento.status === 'aprovado' || orcamento.status === 'finalizado';
            const clienteOk = this.idsIguais(orcClienteId, clienteIdNormalizado) || 
                             this.idsIguais(orcClienteIdAlt, clienteIdNormalizado);
            
            if (clienteOk) {
                console.log('Orçamento do cliente encontrado:', {
                    id: orcamento.id,
                    numero: orcamento.numero,
                    clienteId: orcamento.clienteId || orcamento.cliente_id,
                    status: orcamento.status,
                    statusOk: statusOk
                });
            }
            
            return clienteOk && statusOk;
        });
        
        console.log('✅ Orçamentos aprovados e finalizados encontrados:', orcamentosAprovadosEFinalizados.length);
        
        if (orcamentosAprovadosEFinalizados.length === 0) {
            console.warn('⚠️ Nenhum orçamento aprovado ou finalizado encontrado para este cliente');
            return Promise.resolve([]);
        }
        
        console.log('=== FIM DA BUSCA ===');
        
        return Promise.resolve(orcamentosAprovadosEFinalizados);
    }

    async getOrcamentoCompleto(orcamentoId) {
        const orcamentos = this.getAllSync('orcamentos');
        const orcamento = orcamentos.find(o => o.id == orcamentoId || o.id === orcamentoId);
        
        if (!orcamento) return Promise.resolve(null);
        
        // Calcular valores se não existirem
        if (!orcamento.valorTotal && orcamento.total) {
            orcamento.valorTotal = orcamento.total;
        }
        
        // Buscar serviços e peças
        if (orcamento.servicos && typeof orcamento.servicos === 'string') {
            try {
                orcamento.servicos = JSON.parse(orcamento.servicos);
            } catch (e) {
                orcamento.servicos = [];
            }
        }
        
        if (orcamento.pecas && typeof orcamento.pecas === 'string') {
            try {
                orcamento.pecas = JSON.parse(orcamento.pecas);
            } catch (e) {
                orcamento.pecas = [];
            }
        }
        
        // Calcular totais se necessário
        if (!orcamento.valorTotal) {
            const valorServicos = Array.isArray(orcamento.servicos) 
                ? orcamento.servicos.reduce((sum, s) => sum + (parseFloat(s.valor) || 0), 0)
                : 0;
            const valorPecas = Array.isArray(orcamento.pecas)
                ? orcamento.pecas.reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0)
                : 0;
            const desconto = parseFloat(orcamento.desconto) || 0;
            orcamento.valorTotal = valorServicos + valorPecas - desconto;
        }
        
        return Promise.resolve(orcamento);
    }
}

// Sync Manager
class SyncManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.updateStatus();
    }

    updateStatus() {
        const indicator = document.getElementById('status-indicator');
        const text = document.getElementById('status-text');
        
        if (this.isOnline) {
            indicator.className = 'status-indicator';
            text.textContent = 'Online';
        } else {
            indicator.className = 'status-indicator offline';
            text.textContent = 'Offline';
        }
    }

    // trySync removed in server-first mode

}

// WhatsApp Manager
class WhatsAppManager {
    getSaudacao() {
        const hora = new Date().getHours();
        if (hora >= 5 && hora < 12) return 'Bom dia';
        if (hora >= 12 && hora < 18) return 'Boa tarde';
        if (hora >= 18 && hora <= 23) return 'Boa noite';
        return 'Olá';
    }

    formatarTelefone(telefone) {
        if (!telefone) return '';
        return telefone.replace(/\D/g, '');
    }

    // Retorna o primeiro número de telefone válido encontrado no objeto cliente
    obterTelefoneCliente(cliente) {
        if (!cliente || typeof cliente !== 'object') return '';
        const candidates = [
            cliente.telefone,
            cliente.whatsapp,
            cliente.numero,
            cliente.numeroTelefone,
            cliente.telefone_celular,
            cliente.phone,
            cliente.mobile,
            cliente.celular
        ];
        for (const c of candidates) {
            if (c) {
                const cleaned = String(c).replace(/\D/g, '');
                if (cleaned.length >= 8) return cleaned; // mínimo razoável
            }
        }
        // também tentar varrer propriedades dinamicamente por chave
        for (const k of Object.keys(cliente)) {
            if (/tel|phone|cel|whats?/i.test(k)) {
                const v = cliente[k];
                if (v) {
                    const cleaned = String(v).replace(/\D/g, '');
                    if (cleaned.length >= 8) return cleaned;
                }
            }
        }
        return '';
    }

    formatarDataBR(dataISO) {
        if (!dataISO) return '';
        const [ano, mes, dia] = dataISO.split('-');
        return `${dia}/${mes}/${ano}`;
    }

    gerarMensagem(cliente, duplicata) {
        const saudacao = this.getSaudacao();
        const nomeCliente = (cliente && cliente.nome) ? cliente.nome.split(' ')[0] : (duplicata.cliente || 'Cliente');
        const venc = duplicata.vencimento ? this.formatarDataBR(duplicata.vencimento) : '---';
        const valor = duplicata.valor != null ? Number(duplicata.valor).toFixed(2) : '0.00';
        const statusOrc = (duplicata.status === 'pago') ? 'pago' : 'em aberto';

        const numeroOrc = duplicata.numeroDuplicata || duplicata.numero_duplicata || duplicata.numero || 0;
        return `${saudacao}, ${nomeCliente}! Tudo bem?\nAqui é da Oficina Mecânica Nego Car.\nPassando para informar sobre a duplicata referente a: Orçamento ${numeroOrc}, que se encontra em ${statusOrc}, em nosso sistema\n\n📌 Parcela: ${duplicata.parcela || ''}\n📅 Vencimento: ${venc}\n💰 Valor: R$ ${valor}\n\nSe já realizou o pagamento, por favor nos avise.\n\nObrigado!`;
    }

    // Gera link web (wa.me) — usado apenas como fallback ou visualização
    gerarLinkWeb(telefone, mensagem) {
        const tel = this.formatarTelefone(telefone);
        const msg = encodeURIComponent(mensagem);
        return `https://wa.me/55${tel}?text=${msg}`;
    }

    // Gera link para abrir o aplicativo nativo (scheme)
    gerarLinkApp(telefone, mensagem) {
        const tel = this.formatarTelefone(telefone);
        const msg = encodeURIComponent(mensagem);
        // Formato: whatsapp://send?phone=55{tel}&text={msg}
        return `whatsapp://send?phone=55${tel}&text=${msg}`;
    }

    // Compatibilidade: método único para gerar link (usado pela UI)
    // Atualmente delega para o link web (wa.me). Se desejar priorizar
    // abertura no aplicativo nativo, altere para `this.gerarLinkApp`.
    gerarLink(telefone, mensagem) {
        return this.gerarLinkWeb(telefone, mensagem);
    }

    // Tenta abrir o WhatsApp instalado via URI scheme. Não abre web.whatsapp.com.
    openInApp(telefone, mensagem) {
        const tel = this.formatarTelefone(telefone);
        if (!tel) {
            showToast('Telefone do cliente não disponível para envio via WhatsApp.', 'warning');
            return;
        }

        const appLink = this.gerarLinkApp(telefone, mensagem);

        // Criar um link temporário e forçar clique
        const a = document.createElement('a');
        a.href = appLink;
        a.style.display = 'none';
        document.body.appendChild(a);

        // Tentar abrir app — se não houver handler, o navegador normalmente ignora a ação.
        a.click();
        document.body.removeChild(a);

        // Informar ao usuário caso o app não seja aberto
        setTimeout(() => {
            showToast('Se o WhatsApp não abriu, verifique se o WhatsApp Desktop está instalado no computador.', 'info');
        }, 1200);
    }

    // Gera texto simples do recibo (para usar no corpo do WhatsApp ou imprimir)
    gerarReciboTexto(cliente, duplicata) {
        const nome = cliente && cliente.nome ? cliente.nome : (duplicata.cliente || 'Cliente');
        const telefone = cliente && cliente.telefone ? cliente.telefone : '';
        const dataPagamento = duplicata.dataPagamento || new Date().toISOString().split('T')[0];
        const valor = duplicata.valor != null ? Number(duplicata.valor).toFixed(2) : '0.00';

        return `RECIBO DE PAGAMENTO\n\nOficina Mecânica Nego Car\nCliente: ${nome}\nTelefone: ${telefone}\nDescrição: ${duplicata.descricao}\nParcela: ${duplicata.parcela || ''}\nData Pagamento: ${this.formatarDataBR(dataPagamento)}\nValor: R$ ${valor}\n\nObservações: ${duplicata.observacoes || ''}\n\nObrigado pela preferência!`;
    }

    // Abre uma janela imprimível com o recibo e um botão para enviar via WhatsApp (app)
    abrirReciboImprimivel(cliente, duplicata) {
        const reciboHtml = `\
                    <html>\n\
                    <head>\n\
                        <meta charset="utf-8" />\n\
                        <title>Recibo de Pagamento</title>\n\
                        <style>\n\
                            body { font-family: Arial, sans-serif; margin: 20px; color: #222 }\n\
                            .recibo { max-width: 720px; margin: auto; border: 1px solid #ddd; padding: 20px; }\n\
                            h2 { margin-top: 0; }\n\
                            .linha { display: flex; justify-content: space-between; margin: 6px 0; }\n\
                            .btns { margin-top: 18px; display:flex; gap:10px }\n\
                            .btn { padding: 8px 12px; border-radius: 4px; border: none; cursor: pointer }\n\
                            .btn-print { background:#2ecc71; color:white }\n\
                            .btn-whatsapp { background:#25D366; color:white }\n\
                        </style>\n\
                    </head>\n\
                    <body>\n\
                        <div class="recibo">\n\
                            <h2>Recibo de Pagamento</h2>\n\
                            <div class="linha"><strong>Oficina:</strong><span>Oficina Mecânica Nego Car</span></div>\n\
                            <div class="linha"><strong>Cliente:</strong><span>${cliente && cliente.nome ? cliente.nome : (duplicata.cliente || '')}</span></div>\n\
                            <div class="linha"><strong>Telefone:</strong><span>${cliente && cliente.telefone ? cliente.telefone : ''}</span></div>\n\
                            <div class="linha"><strong>Descrição:</strong><span>${duplicata.descricao || ''}</span></div>\n\
                            <div class="linha"><strong>Parcela:</strong><span>${duplicata.parcela || ''}</span></div>\n\
                            <div class="linha"><strong>Data Pagamento:</strong><span>${this.formatarDataBR(duplicata.dataPagamento || new Date().toISOString().split('T')[0])}</span></div>\n\
                            <div class="linha"><strong>Valor:</strong><span>R$ ${Number(duplicata.valor || 0).toFixed(2)}</span></div>\n\
                            <div style="margin-top:10px"><strong>Observações:</strong><div>${duplicata.observacoes || ''}</div></div>\n\
                            <div class="btns">\n\
                                <button class="btn btn-print" onclick="window.print()">Imprimir / Salvar PDF</button>\n\
                                <a id="whatsapp-app-link" class="btn btn-whatsapp" href="#">Enviar via WhatsApp (App)</a>\n\
                            </div>\n\
                        </div>\n\
                    </body>\n\
                    </html>\
                `;

        const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0,width=800,height=700');
        if (!w) {
            showToast('Não foi possível abrir a janela de recibo. Verifique o bloqueador de popups.', 'error');
            return;
        }
        w.document.open();
        w.document.write(reciboHtml);
        w.document.close();

        // Depois que o conteúdo carregar, configurar o link do botão para abrir o app nativo
        w.addEventListener('load', () => {
            try {
                const msg = this.gerarReciboTexto(cliente, duplicata);
                const tel = cliente && cliente.telefone ? cliente.telefone : '';
                const appLink = this.gerarLinkApp(tel, msg);
                const btn = w.document.getElementById('whatsapp-app-link');
                if (btn) {
                    btn.setAttribute('href', appLink);
                    btn.addEventListener('click', (e) => {
                        // Ao clicar, tentamos abrir o app nativo
                        // O próprio link usa whatsapp://, que deve acionar o handler
                        setTimeout(() => {
                            // Caso o app não abra, informar no parent
                            showToast('Se o WhatsApp não abriu, verifique se o WhatsApp Desktop está instalado.', 'info');
                        }, 1200);
                    });
                }
            } catch (err) {
                console.warn('Erro ao preparar link de WhatsApp no recibo:', err);
            }
        });
    }

    // ... rest of UIManager and global functions omitted for syntax-only check context

// Inicializar sync status
syncManager.updateStatus();
