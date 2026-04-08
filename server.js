const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { app: electronApp } = require('electron');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT) || 3000;

// In-memory store for admin tokens (simple implementation)
const adminTokens = new Set();

// Configuração de schema por módulo para limpeza/backup
const CLEANUP_MODULES = {
    agendamentos: {
        table: 'agendamentos',
        dateField: 'data',
        columns: [
            { name: 'problema', alias: 'descricao' },
            { name: 'numero', alias: 'numero' }
        ]
    },

    transacoes: {
        table: 'transacoes',
        dateField: 'data',
        columns: [
            { name: 'descricao', alias: 'descricao' },
            { name: 'valor', alias: 'valor' }
        ]
    },

    clientes: {
        table: 'clientes',
        dateField: 'created_at',
        columns: [
            { name: 'nome', alias: 'descricao' },
            { name: 'telefone', alias: 'numero' }
        ]
    }
    ,
    orcamentos: {
        table: 'orcamentos',
        dateField: 'data',
        columns: [
            { name: 'observacoes', alias: 'descricao' },
            { name: 'numero', alias: 'numero' },
            { name: 'valor_total', alias: 'valor' }
        ]
    },
    ordens_servico: {
        table: 'ordens_servico',
        dateField: 'data_abertura',
        columns: [
            { name: 'observacoes', alias: 'descricao' },
            { name: 'numero', alias: 'numero' }
        ]
    }
};

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Proxy para ViaCEP para evitar CORS no frontend (Node 18+ já tem fetch nativo)
app.get('/api/cep/:cep', async (req, res) => {
    const cep = req.params.cep.replace(/\D/g, '');

    if (cep.length !== 8) {
        return res.status(400).json({ erro: 'CEP inválido' });
    }

    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);

        if (!response.ok) {
            throw new Error(`ViaCEP respondeu ${response.status}`);
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        console.error('Erro real ao buscar CEP:', error);
        res.status(500).json({ erro: 'Falha ao buscar CEP' });
    }
});
app.use(cors());

// Content Security Policy: permitir apenas origens necessárias (ajuste conforme ambiente)
app.use((req, res, next) => {
    // Em produção, restrinja essas origens ao mínimo necessário.
    // Development-friendly CSP: permite conexões locais (localhost / 127.0.0.1)
    // Em produção, restrinja essas origens ao mínimo necessário.
    const csp = "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdn.jsdelivr.net/npm; " +
                "style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
                "connect-src 'self' http://localhost:3000 http://127.0.0.1:3000 ws://localhost:3000 ws://127.0.0.1:3000; " +
                "img-src 'self' data: https:; " +
                "font-src 'self' https://fonts.gstatic.com; " +
                "frame-ancestors 'self';";
    res.setHeader('Content-Security-Policy', csp);
    next();
});

// Configuração do banco de dados SQLite local
const userDataPath = electronApp.getPath('userData');
const dbPath = path.join(userDataPath, 'database.db');

const packagedDbPath = path.join(process.resourcesPath, 'database.db');
const devDbPath = path.join(__dirname, 'database.db');

// cria a pasta do usuário se não existir
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

// se o banco ainda não existir na pasta do usuário, copia o banco inicial
if (!fs.existsSync(dbPath)) {
  if (fs.existsSync(packagedDbPath)) {
    fs.copyFileSync(packagedDbPath, dbPath);
    console.log('Banco copiado de resources para:', dbPath);
  } else if (fs.existsSync(devDbPath)) {
    fs.copyFileSync(devDbPath, dbPath);
    console.log('Banco copiado da raiz do projeto para:', dbPath);
  } else {
    console.error('Nenhum database.db encontrado para copiar.');
  }
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir banco:', err.message);
  } else {
    console.log('Banco aberto em:', dbPath);
  }
});

// Evitar que a conexão feche antes de usar
// db.configure('busyTimeout', 30000);

// Inicializar tabelas do banco de dados
function inicializarBanco() {
    db.serialize(() => {
        // Tabela de clientes
        db.run(`CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            telefone TEXT UNIQUE,
            endereco TEXT,
            veiculos TEXT,
            ativo INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Garantir UNIQUE em telefone mesmo em bancos já existentes
        db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone)');

        // Tabela de agendamentos
        db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_id INTEGER,
            veiculo_id INTEGER,
            numero INTEGER,
            data TEXT NOT NULL,
            hora TEXT,
            problema TEXT,
            servico TEXT,
            observacoes TEXT,
            status TEXT DEFAULT 'pendente',
            notificacoes TEXT,
            whatsapp_enviado INTEGER DEFAULT 0,
            lembrete_enviado INTEGER DEFAULT 0,
            data_finalizacao TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )`);

        const agendamentoColumnsToAdd = [
            'ALTER TABLE agendamentos ADD COLUMN veiculo_id INTEGER',
            'ALTER TABLE agendamentos ADD COLUMN numero INTEGER',
            'ALTER TABLE agendamentos ADD COLUMN problema TEXT',
            'ALTER TABLE agendamentos ADD COLUMN notificacoes TEXT',
            'ALTER TABLE agendamentos ADD COLUMN whatsapp_enviado INTEGER DEFAULT 0',
            'ALTER TABLE agendamentos ADD COLUMN lembrete_enviado INTEGER DEFAULT 0',
            'ALTER TABLE agendamentos ADD COLUMN data_finalizacao TEXT',
            'ALTER TABLE agendamentos ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP',
            'ALTER TABLE agendamentos ADD COLUMN motivo_cancelamento TEXT',
            'ALTER TABLE agendamentos ADD COLUMN cancelado_em TEXT'
        ];

        agendamentoColumnsToAdd.forEach(sql => {
            db.run(sql, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Erro ao atualizar tabela agendamentos:', err.message);
                }
            });
        });

        // Tabela de orçamentos
        db.run(`CREATE TABLE IF NOT EXISTS orcamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero INTEGER,
            cliente_id INTEGER,
            veiculo_id INTEGER,
            agendamento_id INTEGER,
            servicos TEXT,
            pecas TEXT,
            observacoes TEXT,
            validade INTEGER,
            data TEXT,
            desconto REAL,
            valor_total REAL,
            total REAL,
            status TEXT DEFAULT 'pendente',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )`);

        const orcamentoColumnsToAdd = [
            'ALTER TABLE orcamentos ADD COLUMN numero INTEGER',
            'ALTER TABLE orcamentos ADD COLUMN agendamento_id INTEGER',
            'ALTER TABLE orcamentos ADD COLUMN observacoes TEXT',
            'ALTER TABLE orcamentos ADD COLUMN validade INTEGER',
            'ALTER TABLE orcamentos ADD COLUMN data TEXT',
            'ALTER TABLE orcamentos ADD COLUMN desconto REAL',
            'ALTER TABLE orcamentos ADD COLUMN total REAL',
            'ALTER TABLE orcamentos ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP',
            'ALTER TABLE orcamentos ADD COLUMN status_financeiro TEXT',
            'ALTER TABLE orcamentos ADD COLUMN data_duplicata TEXT',
            'ALTER TABLE orcamentos ADD COLUMN data_liquidacao TEXT',
            'ALTER TABLE orcamentos ADD COLUMN motivo_cancelamento TEXT',
            'ALTER TABLE orcamentos ADD COLUMN cancelado_em TEXT'
        ];

        orcamentoColumnsToAdd.forEach(sql => {
            db.run(sql, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Erro ao atualizar tabela orcamentos:', err.message);
                }
            });
        });

        // Tabela de transações
        db.run(`CREATE TABLE IF NOT EXISTS transacoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orcamento_id INTEGER,
            cliente_id INTEGER,
            categoria_id INTEGER,
            descricao TEXT,
            tipo TEXT NOT NULL,
            valor REAL NOT NULL,
            data TEXT NOT NULL,
            status TEXT DEFAULT 'pendente',
            observacoes TEXT,
            parcela_de INTEGER,
            numero_parcela INTEGER,
            total_parcelas INTEGER,
            is_duplicata INTEGER DEFAULT 0,
            numero_duplicata INTEGER,
            forma_pagamento TEXT,
            parcelado INTEGER DEFAULT 0,
            num_parcelas INTEGER,
            confirmado_em TEXT,
            criado_em TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME,
            grupo_parcelamento_id TEXT,
            FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id),
            FOREIGN KEY (cliente_id) REFERENCES clientes(id)
        )`);

        const transacaoColumnsToAdd = [
            'ALTER TABLE transacoes ADD COLUMN orcamento_id INTEGER',
            'ALTER TABLE transacoes ADD COLUMN cliente_id INTEGER',
            'ALTER TABLE transacoes ADD COLUMN categoria_id INTEGER',
            'ALTER TABLE transacoes ADD COLUMN status TEXT DEFAULT "pendente"',
            'ALTER TABLE transacoes ADD COLUMN observacoes TEXT',
            'ALTER TABLE transacoes ADD COLUMN parcela_de INTEGER',
            'ALTER TABLE transacoes ADD COLUMN numero_parcela INTEGER',
            'ALTER TABLE transacoes ADD COLUMN total_parcelas INTEGER',
            'ALTER TABLE transacoes ADD COLUMN is_duplicata INTEGER DEFAULT 0',
            'ALTER TABLE transacoes ADD COLUMN numero_duplicata INTEGER',
            'ALTER TABLE transacoes ADD COLUMN forma_pagamento TEXT',
            'ALTER TABLE transacoes ADD COLUMN parcelado INTEGER DEFAULT 0',
            'ALTER TABLE transacoes ADD COLUMN num_parcelas INTEGER',
            'ALTER TABLE transacoes ADD COLUMN confirmado_em TEXT',
            'ALTER TABLE transacoes ADD COLUMN criado_em TEXT',
            'ALTER TABLE transacoes ADD COLUMN vencimento TEXT',
            'ALTER TABLE transacoes ADD COLUMN data_pagamento TEXT',
            'ALTER TABLE transacoes ADD COLUMN grupo_parcelamento_id TEXT',
            'ALTER TABLE transacoes ADD COLUMN updated_at DATETIME'
            , 'ALTER TABLE transacoes ADD COLUMN fornecedor TEXT'
            , 'ALTER TABLE transacoes ADD COLUMN desconto REAL'
        ];

        transacaoColumnsToAdd.forEach(sql => {
            db.run(sql, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Erro ao atualizar tabela transacoes:', err.message);
                }
            });
        });

        // Criar índice único para evitar lançamentos duplicados por orçamento quando for duplicata
        // Usa index parcial: apenas aplica quando is_duplicata = 1 (SQLite suporta partial index em versões modernas)
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transacoes_orcamento_duplicata ON transacoes(orcamento_id) WHERE is_duplicata = 1`, (err) => {
            if (err) {
                // Se houver erro (por exemplo, versão antiga do SQLite ou dados duplicados existentes), logamos para investigação
                console.error('Aviso: não foi possível criar índice único para duplicatas:', err.message);
            } else {
                console.log('Índice único idx_transacoes_orcamento_duplicata criado/verificado');
            }
        });

        // Tabela de usuários
        db.run(`CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE,
            senha TEXT,
            logo TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela para armazenamento genérico de dados persistentes
        db.run(`CREATE TABLE IF NOT EXISTS storage (
            chave TEXT PRIMARY KEY,
            valor TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS ordens_servico (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero INTEGER,
            orcamento_id INTEGER,
            cliente_id INTEGER,
            veiculo_id INTEGER,
            agendamento_id INTEGER,
            servicos TEXT,
            pecas TEXT,
            observacoes TEXT,
            status TEXT DEFAULT 'pendente',
            data_abertura TEXT,
            data_finalizacao TEXT,
            whatsapp_enviado INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id)
        )`);

        console.log('Tabelas do banco de dados inicializadas com sucesso');
    });
}

// Helper para normalizar campos de uma transação antes de enviar ao cliente
function normalizeTransacao(row) {
    const normalized = Object.assign({}, row);

    // clienteId: preferir cliente_id, clienteId; garantir número ou null
    let cid = row.cliente_id !== undefined && row.cliente_id !== null ? row.cliente_id : row.clienteId;
    if (cid === '' || cid === false || cid === true) cid = null;
    if (cid !== null && cid !== undefined) {
        const n = parseInt(cid);
        normalized.clienteId = Number.isNaN(n) ? String(cid) : n;
    } else {
        normalized.clienteId = null;
    }

    // parcelado: aceitar 1/0, '1'/'0', true/false
    normalized.parcelado = (row.parcelado === 1 || row.parcelado === '1' || row.parcelado === true || row.parcelado === 'true');

    // valor: garantir number
    let v = row.valor !== undefined ? row.valor : row.value;
    if (typeof v === 'string') {
        // remover milhares e trocar vírgula decimal
        v = v.replace(/[^0-9,-\.]/g, '').replace(/\./g, '').replace(/,/g, '.');
    }
    const vn = parseFloat(v);
    normalized.valor = Number.isFinite(vn) ? vn : 0;

    // status: normalizar para lowercase se existir
    normalized.status = row.status ? String(row.status).toLowerCase() : 'pendente';

    // vencimento/data: tentar normalizar para ISO date (YYYY-MM-DD)
    const venc = row.vencimento || row.data || row.created_at || row.criado_em;
    if (venc) {
        try {
            const d = new Date(venc);
            if (!isNaN(d.getTime())) normalized.vencimento = d.toISOString();
            else normalized.vencimento = null;
        } catch (e) {
            normalized.vencimento = null;
        }
    } else {
        normalized.vencimento = null;
    }

    return normalized;
}

function purgeDeletedFinanceiroFromStorage(deletedId, callback = () => {}) {
  db.all('SELECT chave, valor FROM storage', [], (err, rows) => {
    if (err) {
      console.error('Erro ao ler storage para limpeza:', err.message);
      return callback();
    }

    if (!rows || rows.length === 0) {
      return callback();
    }

    const keysPreferenciais = new Set([
      'receber',
      'financeiro',
      'transacoes',
      'contasReceber',
      'contas_a_receber',
      'syncQueue',
      'filaSync',
      'financeiro_receber'
    ]);

    let pendentes = 0;
    let houveAtualizacao = false;

    const finalizar = () => {
      if (pendentes <= 0) callback();
    };

    const idsIguais = (a, b) => String(a ?? '') === String(b ?? '');

    const filtrarRecursivo = (valor) => {
      if (Array.isArray(valor)) {
        return valor
          .filter(item => {
            if (!item || typeof item !== 'object') return true;

            const itemId =
              item.id ??
              item.itemId ??
              item.registroId ??
              item.financeiroId ??
              item.transacaoId;

            return !idsIguais(itemId, deletedId);
          })
          .map(filtrarRecursivo);
      }

      if (valor && typeof valor === 'object') {
        const novo = { ...valor };

        for (const chave of Object.keys(novo)) {
          novo[chave] = filtrarRecursivo(novo[chave]);
        }

        return novo;
      }

      return valor;
    };

    rows.forEach((row) => {
      if (!row || typeof row.valor !== 'string') return;

      const deveTentar =
        keysPreferenciais.has(row.chave) ||
        row.valor.includes(`"id":${Number(deletedId)}`) ||
        row.valor.includes(`"id":"${String(deletedId)}"`);

      if (!deveTentar) return;

      let original;
      try {
        original = JSON.parse(row.valor);
      } catch {
        return;
      }

      const filtrado = filtrarRecursivo(original);
      const originalStr = JSON.stringify(original);
      const filtradoStr = JSON.stringify(filtrado);

      if (originalStr === filtradoStr) return;

      houveAtualizacao = true;
      pendentes++;

      db.run(
        `INSERT INTO storage (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [row.chave, filtradoStr],
        (updateErr) => {
          if (updateErr) {
            console.error(`Erro ao atualizar storage (${row.chave}):`, updateErr.message);
          } else {
            console.log(`Storage limpo para a chave: ${row.chave} | id removido: ${deletedId}`);
          }

          pendentes--;
          finalizar();
        }
      );
    });

    if (!houveAtualizacao) {
      return callback();
    }

    if (pendentes === 0) {
      return callback();
    }
  });
}

// ========== DETECÇÃO DO WHATSAPP ==========
// Função para verificar se WhatsApp está instalado no sistema
function whatsappEstaInstalado() {
    try {
        const os = require('os');
        const path = require('path');
        
        console.log(`\n[DEBUG WhatsApp] Verificando instalação... (Platform: ${process.platform})`);
        
        // No Windows, procura o executável do WhatsApp em locais comuns
        if (process.platform === 'win32') {
            const username = os.userInfo().username;
            const homeDir = os.homedir();
            console.log(`[DEBUG WhatsApp] Username: ${username}`);
            
            // Locais onde WhatsApp pode estar instalado
            const possiblePaths = [
                // Instalação tradicional
                path.join(homeDir, 'AppData', 'Local', 'WhatsApp'),
                `C:\\Program Files\\WhatsApp`,
                `C:\\Program Files (x86)\\WhatsApp`,
                // Microsoft Store (AppData\Local\Packages)
                path.join(homeDir, 'AppData', 'Local', 'Packages'),
                // Roaming (algumas versões)
                path.join(homeDir, 'AppData', 'Roaming'),
            ];
            
            console.log(`[DEBUG WhatsApp] Verificando caminhos...`);
            
            // 1. Verificar instalação tradicional
            const traditionalPath = path.join(homeDir, 'AppData', 'Local', 'WhatsApp');
            console.log(`  1. Tradicional: ${traditionalPath}`);
            if (fs.existsSync(traditionalPath)) {
                const files = fs.readdirSync(traditionalPath);
                console.log(`    ✓ Existe! Arquivos: ${files.slice(0, 3).join(', ')}`);
                const hasExe = files.some(f => f === 'WhatsApp.exe' || f.startsWith('app-'));
                if (hasExe) {
                    console.log(`    ✓ ENCONTRADO (arquivo executável encontrado)`);
                    return true;
                }
            }
            
            // 2. Verificar Program Files
            const progFiles = [`C:\\Program Files\\WhatsApp`, `C:\\Program Files (x86)\\WhatsApp`];
            for (const progPath of progFiles) {
                console.log(`  2. ${progPath}`);
                try {
                    if (fs.existsSync(progPath)) {
                        console.log(`    ✓ ENCONTRADO`);
                        return true;
                    }
                } catch (e) {
                    // ignorar
                }
            }
            
            // 3. Verificar Microsoft Store
            const packagesPath = path.join(homeDir, 'AppData', 'Local', 'Packages');
            console.log(`  3. Microsoft Store: ${packagesPath}`);
            try {
                if (fs.existsSync(packagesPath)) {
                    const packages = fs.readdirSync(packagesPath);
                    const whatsappPackage = packages.find(p => p.includes('WhatsApp') || p.includes('whatsapp'));
                    if (whatsappPackage) {
                        console.log(`    ✓ ENCONTRADO (Microsoft Store): ${whatsappPackage}`);
                        return true;
                    }
                }
            } catch (e) {
                // ignorar
            }
            
            console.log(`✗ WhatsApp NÃO ENCONTRADO em nenhum local comum`);
            return false;
        }
        
        // No macOS
        if (process.platform === 'darwin') {
            console.log(`  → /Applications/WhatsApp.app`);
            try {
                fs.statSync('/Applications/WhatsApp.app');
                console.log(`  ✓ ENCONTRADO`);
                return true;
            } catch (e) {
                console.log(`  ✗ Não encontrado`);
                return false;
            }
        }
        
        // No Linux
        if (process.platform === 'linux') {
            console.log(`  → Verificando comando whatsapp`);
            const { execSync } = require('child_process');
            try {
                execSync('which whatsapp', { stdio: 'ignore' });
                console.log(`  ✓ ENCONTRADO`);
                return true;
            } catch (e) {
                console.log(`  ✗ Não encontrado`);
                return false;
            }
        }
        
        console.log(`✗ Plataforma desconhecida`);
        return false;
    } catch (error) {
        console.error('❌ Erro ao verificar WhatsApp:', error.message);
        return false;
    }
}

// Rotas comentadas para teste
/*
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET endpoints
... [todo o resto dos endpoints] ...
*/

// ========== ENDPOINT: DETECTAR WHATSAPP ==========
// GET /api/whatsapp-status - Verifica se WhatsApp está instalado
app.get('/api/whatsapp-status', (req, res) => {
    const instalado = whatsappEstaInstalado();
    console.log(`[WhatsApp Status] Instalado: ${instalado}, Platform: ${process.platform}`);
    res.json({ whatsappInstalado: instalado, platform: process.platform });
});

// Iniciar servidor
app.get('/api/clientes', (req, res) => {
    db.all('SELECT * FROM clientes WHERE ativo = 1 ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        // Converter campos JSON de volta para objetos
        const clientes = rows.map(row => ({
            ...row,
            endereco: row.endereco ? JSON.parse(row.endereco) : {},
            veiculos: row.veiculos ? JSON.parse(row.veiculos) : []
        }));
        res.json(clientes);
    });
});

app.get('/api/agendamentos', (req, res) => {
    db.all('SELECT * FROM agendamentos ORDER BY data DESC, hora DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const agendamentos = rows.map(row => ({
            ...row,
            notificacoes: row.notificacoes ? JSON.parse(row.notificacoes) : []
        }));

        res.json(agendamentos);
    });
});

app.get('/api/orcamentos', (req, res) => {
    db.all('SELECT * FROM orcamentos ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const orcamentos = rows.map(row => ({
            ...row,
            servicos: row.servicos ? JSON.parse(row.servicos) : [],
            pecas: row.pecas ? JSON.parse(row.pecas) : []
        }));
        res.json(orcamentos);
    });
});

app.get('/api/ordens-servico', (req, res) => {
    db.all('SELECT * FROM ordens_servico ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const ordens = rows.map(row => ({
            ...row,
            servicos: row.servicos ? JSON.parse(row.servicos) : [],
            pecas: row.pecas ? JSON.parse(row.pecas) : []
        }));
        res.json(ordens);
    });
});

app.get('/api/transacoes', (req, res) => {
    db.all('SELECT * FROM transacoes ORDER BY data DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const transacoes = rows.map(row => {
            const n = normalizeTransacao(row);
            return {
                ...n,
                orcamentoId: row.orcamento_id || row.orcamentoId || null,
                categoriaId: row.categoria_id || row.categoriaId || null,
                parcelaDe: row.parcela_de || row.parcelaDe || null,
                numeroParcela: row.numero_parcela || row.numeroParcela || null,
                totalParcelas: row.total_parcelas || row.totalParcelas || null,
                isDuplicata: row.is_duplicata === 1 || row.isDuplicata === true,
                numeroDuplicata: row.numero_duplicata || row.numeroDuplicata || null,
                formaPagamento: row.forma_pagamento || row.formaPagamento || null,
                numParcelas: row.num_parcelas || row.numParcelas || null,
                confirmadoEm: row.confirmado_em || row.confirmadoEm || null,
                criadoEm: row.criado_em || row.criadoEm || null
            };
        });
        res.json(transacoes);
    });
});

// =========================
// FINANCEIRO
// =========================

// Listar lançamentos financeiros
app.get('/api/financeiro', (req, res) => {
    db.all('SELECT * FROM transacoes ORDER BY data DESC, id DESC', [], (err, rows) => {
        if (err) {
            console.error('Erro ao listar financeiro:', err.message);
            return res.status(500).json({ error: err.message });
        }

        const dados = rows.map(row => {
            const n = normalizeTransacao(row);

            return {
                ...n,
                id: String(row.id),
                orcamentoId: row.orcamento_id || row.orcamentoId || null,
                clienteId: row.cliente_id || row.clienteId || null,
                categoriaId: row.categoria_id || row.categoriaId || null,
                parcelaDe: row.parcela_de || row.parcelaDe || null,
                numeroParcela: row.numero_parcela || row.numeroParcela || null,
                totalParcelas: row.total_parcelas || row.totalParcelas || null,
                isDuplicata: row.is_duplicata === 1 || row.isDuplicata === true,
                numeroDuplicata: row.numero_duplicata || row.numeroDuplicata || null,
                formaPagamento: row.forma_pagamento || row.formaPagamento || null,
                numParcelas: row.num_parcelas || row.numParcelas || null,
                confirmadoEm: row.confirmado_em || row.confirmadoEm || null,
                criadoEm: row.criado_em || row.criadoEm || null,
                fornecedor: row.fornecedor || null,
                desconto: row.desconto != null && row.desconto !== '' ? Number(row.desconto) : null,
                descontoAVista: row.desconto != null && row.desconto !== '' ? Number(row.desconto) : null
            };
        });

        res.json(dados);
    });
});

// Deletar lançamento financeiro por ID (contas a receber: exige senha admin ou sessão admin)
app.delete('/api/financeiro/:id', (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  db.get('SELECT * FROM transacoes WHERE id = ?', [id], (getErr, row) => {
    if (getErr) {
      console.error('Erro ao buscar lançamento:', getErr.message);
      return res.status(500).json({ error: getErr.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }

    const tipoRow = (row.tipo || '').toLowerCase();

    if (tipoRow === 'receber' && !verifyAdminPasswordOrCookie(req)) {
      return res.status(403).json({
        error: 'É necessária a senha do administrador para excluir contas a receber.'
      });
    }

    db.run('DELETE FROM transacoes WHERE id = ?', [id], function (err) {
      if (err) {
        console.error('Erro ao deletar lançamento:', err.message);
        return res.status(500).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Registro não encontrado' });
      }

      purgeDeletedFinanceiroFromStorage(id, () => {
        return res.json({
          success: true,
          message: 'Lançamento deletado com sucesso',
          deletedId: String(id)
        });
      });
    });
  });
});

app.get('/api/usuarios', (req, res) => {
    db.all('SELECT * FROM usuarios', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Endpoints para armazenamento genérico (sincronização com localStorage)
app.get('/api/storage', (req, res) => {
    db.all('SELECT chave, valor FROM storage', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/storage/:chave', (req, res) => {
    const chave = req.params.chave;
    db.get('SELECT chave, valor FROM storage WHERE chave = ?', [chave], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Chave não encontrada' });
            return;
        }
        res.json(row);
    });
});

app.post('/api/storage', (req, res) => {
    const { chave, valor } = req.body;

    if (!chave) {
        res.status(400).json({ error: 'Chave é obrigatória' });
        return;
    }

    db.run(
        `INSERT INTO storage (chave, valor) VALUES (?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [chave, valor ?? null],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ chave, valor });
        }
    );
});

app.delete('/api/storage/:chave', (req, res) => {
    const chave = req.params.chave;
    db.run('DELETE FROM storage WHERE chave = ?', [chave], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Chave não encontrada' });
            return;
        }
        res.json({ message: 'Chave removida com sucesso' });
    });
});

app.delete('/api/storage', (req, res) => {
    db.run('DELETE FROM storage', [], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Todos os dados de storage foram removidos' });
    });
});

// (Removidos handlers duplicados de lista/exclusão de limpeza — versão consolidada mantida mais abaixo)

// Endpoint seguro para limpar registros do módulo financeiro por período
// Requisitos de segurança:
// - body.startDate e body.endDate (YYYY-MM-DD) obrigatórios
// - body.confirm === true
// - Se variável de ambiente ADMIN_PASSWORD definida, header 'x-admin-password' deve corresponder
app.post('/api/financeiro/cleanup', (req, res) => {
    const { startDate, endDate, beforeDate, confirm, tipo } = req.body || {};
    const inicio = startDate || beforeDate;
    const fim = endDate || beforeDate;

    if (!inicio || !fim) {
        res.status(400).json({ error: 'startDate e endDate são obrigatórios (YYYY-MM-DD)' });
        return;
    }
    if (inicio > fim) {
        res.status(400).json({ error: 'startDate não pode ser maior que endDate' });
        return;
    }
    if (!confirm) {
        res.status(400).json({ error: 'Confirmação obrigatória. Envie { confirm: true }' });
        return;
    }

    // Autenticação: aceitar header x-admin-password OR cookie admin_token válido
    const adminPassEnv = process.env.ADMIN_PASSWORD;
    const provided = req.headers['x-admin-password'];
    const cookieHeader = req.headers.cookie || '';
    const cookieToken = (cookieHeader.match(/(?:^|; )admin_token=([^;]+)/) || [])[1];

    let authorized = false;
    if (adminPassEnv && provided && provided === adminPassEnv) authorized = true;
    if (cookieToken && adminTokens.has(cookieToken)) authorized = true;

    if (!authorized) {
        res.status(403).json({ error: 'Acesso negado. É necessária autenticação administrativa.' });
        return;
    }

    // Construir cláusula WHERE para filtrar por tipo se especificado
    let whereClause = '((vencimento IS NOT NULL AND vencimento >= ? AND vencimento <= ?) OR (data IS NOT NULL AND data >= ? AND data <= ?))';
    let params = [inicio, fim, inicio, fim];
    
    if (tipo && (tipo === 'receber' || tipo === 'pagar')) {
        whereClause += ` AND tipo = ?`;
        params.push(tipo);
    }

    // Buscar registros que serão removidos (baseado em vencimento ou data)
    const sqlSelect = `SELECT * FROM transacoes WHERE ${whereClause}`;
    db.all(sqlSelect, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (!rows || rows.length === 0) {
            res.json({ deleted: 0, backup: null, message: 'Nenhum registro encontrado no período informado' });
            return;
        }

        // Garantir diretório de backup
        const backupsDir = path.join(userDataPath, 'backups');
        try {
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
        } catch (mkdirErr) {
            console.error('Erro ao criar pasta de backups:', mkdirErr.message);
            res.status(500).json({ error: 'Erro ao preparar pasta de backup: ' + mkdirErr.message });
            return;
        }

        const tipoLabel = tipo === 'receber' ? 'receber' : (tipo === 'pagar' ? 'pagar' : 'misto');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupsDir, `financeiro-${tipoLabel}-backup-${timestamp}.json`);

        try {
            fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2), 'utf8');
        } catch (writeErr) {
            res.status(500).json({ error: 'Erro ao salvar backup: ' + writeErr.message });
            return;
        }

        // Fazer remoção segura por ids
        const ids = rows.map(r => r.id).filter(Boolean);
        if (ids.length === 0) {
            res.json({ deleted: 0, backup: backupPath, removedItems: [] });
            return;
        }

        const placeholders = ids.map(() => '?').join(',');
        const deleteSql = `DELETE FROM transacoes WHERE id IN (${placeholders})`;
        db.run(deleteSql, ids, function(deleteErr) {
            if (deleteErr) {
                res.status(500).json({ error: deleteErr.message });
                return;
            }

            const removedItems = rows.map(r => ({ id: r.id ? String(r.id) : null, tipo: r.tipo || null }));
            res.json({ deleted: this.changes, backup: backupPath, removedIds: ids, removedItems });
        });
    });
});

// Admin login endpoints (master login)
// Credenciais pré-configuradas do administrador do sistema
const ADMIN_USERNAME = 'Nego Car';
const ADMIN_PASSWORD_HARDCODED = 'N2019@'

app.post('/api/admin/login', express.json(), (req, res) => {
    const { username, password } = req.body || {};
    
    // Validar credenciais contra o admin pré-configurado
    if (!username || !password || username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD_HARDCODED) {
        res.status(403).json({ error: 'Usuário ou senha inválida' });
        return;
    }

    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.add(token);
    // set cookie (HttpOnly)
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookieToken = (cookieHeader.match(/(?:^|; )admin_token=([^;]+)/) || [])[1];
    if (cookieToken && adminTokens.has(cookieToken)) {
        adminTokens.delete(cookieToken);
    }
    // clear cookie
    res.clearCookie('admin_token');
    res.json({ success: true });
});

app.get('/api/admin/status', (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookieToken = (cookieHeader.match(/(?:^|; )admin_token=([^;]+)/) || [])[1];
    const isAdmin = cookieToken && adminTokens.has(cookieToken);
    res.json({ isAdmin: !!isAdmin });
});

// --- Backup Google Drive: configuração só admin; envio do backup qualquer usuário do app ---
const driveOAuthPending = new Map();

function getAdminCookieToken(req) {
    const cookieHeader = req.headers.cookie || '';
    const m = cookieHeader.match(/(?:^|; )admin_token=([^;]+)/);
    return m ? decodeURIComponent(m[1].trim()) : null;
}

function isAdminRequest(req) {
    const t = getAdminCookieToken(req);
    return !!(t && adminTokens.has(t));
}

function requireAdminJson(req, res) {
    if (!isAdminRequest(req)) {
        res.status(403).json({ error: 'Apenas o administrador pode acessar esta função.' });
        return false;
    }
    return true;
}

/** Senha admin (header x-admin-password), variável ADMIN_PASSWORD ou sessão admin (cookie). */
function verifyAdminPasswordOrCookie(req) {
    const adminPassEnv = process.env.ADMIN_PASSWORD;
    const provided = req.headers['x-admin-password'];
    const cookieHeader = req.headers.cookie || '';
    const cookieToken = (cookieHeader.match(/(?:^|; )admin_token=([^;]+)/) || [])[1];
    if (cookieToken && adminTokens.has(decodeURIComponent(cookieToken.trim()))) return true;
    if (adminPassEnv && provided && provided === adminPassEnv) return true;
    if (provided && provided === ADMIN_PASSWORD_HARDCODED) return true;
    return false;
}

function mergeFinanceiroUpdate(entrada, row) {
    const status = entrada.status !== undefined ? entrada.status : row.status;
    const descricao = entrada.descricao !== undefined ? entrada.descricao : (row.descricao || '');
    const observacoes = entrada.observacoes !== undefined ? entrada.observacoes : (row.observacoes || '');
    const dataPagamento = entrada.dataPagamento !== undefined ? entrada.dataPagamento : row.data_pagamento;
    const fornecedor = entrada.fornecedor !== undefined
        ? entrada.fornecedor
        : (entrada.fornecedorNome !== undefined ? entrada.fornecedorNome : row.fornecedor);
    const grupoParcelamentoId = entrada.grupoParcelamentoId !== undefined ? entrada.grupoParcelamentoId : row.grupo_parcelamento_id;
    const valor = entrada.valor !== undefined && entrada.valor !== null && entrada.valor !== ''
        ? Number(entrada.valor)
        : row.valor;
    const vencimento = entrada.vencimento !== undefined ? entrada.vencimento : row.vencimento;
    const data = entrada.data !== undefined ? entrada.data : row.data;
    let desconto;
    if (entrada.desconto !== undefined && entrada.desconto !== null && entrada.desconto !== '') {
        desconto = Number(entrada.desconto);
    } else if (entrada.descontoAVista !== undefined && entrada.descontoAVista !== null && entrada.descontoAVista !== '') {
        desconto = Number(entrada.descontoAVista);
    } else if (row.desconto != null && row.desconto !== '') {
        desconto = Number(row.desconto);
    } else {
        desconto = 0;
    }
    if (Number.isNaN(desconto)) desconto = 0;
    return {
        status: status || 'aberto',
        descricao,
        observacoes,
        dataPagamento,
        fornecedor,
        grupoParcelamentoId,
        valor,
        vencimento,
        data,
        desconto
    };
}

const backupDriveConfigPath = path.join(userDataPath, 'google-drive-backup.json');

function parseDriveFolderId(input) {
    if (!input) return '';
    const s = String(input).trim();
    const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    return s;
}

function loadBackupDriveConfig() {
    try {
        if (!fs.existsSync(backupDriveConfigPath)) return null;
        return JSON.parse(fs.readFileSync(backupDriveConfigPath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function saveBackupDriveConfig(obj) {
    fs.writeFileSync(backupDriveConfigPath, JSON.stringify(obj, null, 2), 'utf8');
}

// Escopo amplo para permitir envio a uma pasta específica do Drive (uso interno / admin confia)
const DRIVE_BACKUP_SCOPES = ['https://www.googleapis.com/auth/drive'];

setInterval(() => {
    const now = Date.now();
    for (const [st, data] of driveOAuthPending.entries()) {
        if (data && data.expires < now) driveOAuthPending.delete(st);
    }
}, 5 * 60 * 1000);

app.get('/api/backup/drive/status', (req, res) => {
    const c = loadBackupDriveConfig();
    const configured = !!(c && c.refreshToken && c.clientId && c.clientSecret);
    res.json({ configured });
});

app.post('/api/backup/drive', async (req, res) => {
    const c = loadBackupDriveConfig();
    if (!c || !c.refreshToken || !c.clientId || !c.clientSecret) {
        res.status(400).json({ error: 'Backup Google Drive não configurado. Peça ao administrador para configurar em Configurações.' });
        return;
    }
    const tmpName = `database-backup-${Date.now()}.db`;
    const tmpPath = path.join(userDataPath, tmpName);
    try {
        fs.copyFileSync(dbPath, tmpPath);
    } catch (e) {
        res.status(500).json({ error: 'Não foi possível copiar o banco de dados: ' + e.message });
        return;
    }
    let uploaded;
    try {
        const { google } = require('googleapis');
        const redirectUri = `http://127.0.0.1:${PORT}/api/oauth/google-drive/callback`;
        const oauth2Client = new google.auth.OAuth2(c.clientId, c.clientSecret, redirectUri);
        oauth2Client.setCredentials({ refresh_token: c.refreshToken });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `negocar-database-${stamp}.db`;
        const requestBody = { name: fileName };
        if (c.folderId) requestBody.parents = [c.folderId];
        const resp = await drive.files.create({
            requestBody,
            media: {
                mimeType: 'application/octet-stream',
                body: fs.createReadStream(tmpPath)
            },
            fields: 'id,name,webViewLink'
        });
        uploaded = resp.data;
    } catch (err) {
        console.error('Backup Drive:', err);
        try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
        res.status(500).json({ error: (err && err.message) ? err.message : 'Falha ao enviar para o Google Drive' });
        return;
    }
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    res.json({
        success: true,
        fileName: uploaded.name,
        id: uploaded.id,
        webViewLink: uploaded.webViewLink || null
    });
});

app.get('/api/admin/backup-drive/config', (req, res) => {
    if (!requireAdminJson(req, res)) return;
    const c = loadBackupDriveConfig();
    if (!c) {
        res.json({ configured: false, folderId: '', clientIdPreview: '', hasRefreshToken: false });
        return;
    }
    const cid = c.clientId || '';
    const prev = cid.length > 8 ? cid.slice(0, 4) + '…' + cid.slice(-4) : cid;
    res.json({
        configured: !!(c.refreshToken && c.clientId && c.clientSecret),
        folderId: c.folderId || '',
        clientIdPreview: prev,
        hasRefreshToken: !!c.refreshToken
    });
});

app.post('/api/admin/backup-drive/config', express.json(), (req, res) => {
    if (!requireAdminJson(req, res)) return;
    const { clientId, clientSecret, refreshToken, folderId } = req.body || {};
    if (!clientId || !clientSecret || !refreshToken) {
        res.status(400).json({ error: 'Informe Client ID, Client Secret e Refresh Token.' });
        return;
    }
    const existing = loadBackupDriveConfig() || {};
    saveBackupDriveConfig({
        ...existing,
        clientId: String(clientId).trim(),
        clientSecret: String(clientSecret).trim(),
        refreshToken: String(refreshToken).trim(),
        folderId: folderId ? parseDriveFolderId(folderId) : ''
    });
    res.json({ success: true });
});

app.post('/api/admin/backup-drive/oauth-url', express.json(), (req, res) => {
    if (!requireAdminJson(req, res)) return;
    const { clientId, clientSecret, folderId } = req.body || {};
    if (!clientId || !clientSecret) {
        res.status(400).json({ error: 'Informe Client ID e Client Secret (Google Cloud Console).' });
        return;
    }
    const state = crypto.randomBytes(24).toString('hex');
    const redirectUri = `http://127.0.0.1:${PORT}/api/oauth/google-drive/callback`;
    driveOAuthPending.set(state, {
        clientId: String(clientId).trim(),
        clientSecret: String(clientSecret).trim(),
        folderId: folderId ? parseDriveFolderId(folderId) : '',
        expires: Date.now() + 15 * 60 * 1000
    });
    const params = new URLSearchParams({
        client_id: String(clientId).trim(),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_BACKUP_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ authUrl, redirectUri });
});

app.get('/api/oauth/google-drive/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) {
        res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Erro Google: ${String(error)}</p></body></html>`);
        return;
    }
    if (!code || !state) {
        res.status(400).send('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Resposta inválida.</p></body></html>');
        return;
    }
    const pending = driveOAuthPending.get(String(state));
    if (!pending || pending.expires < Date.now()) {
        res.status(400).send('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Link expirado. Gere um novo em Configurações → Backup Google Drive.</p></body></html>');
        return;
    }
    driveOAuthPending.delete(String(state));
    const redirectUri = `http://127.0.0.1:${PORT}/api/oauth/google-drive/callback`;
    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: String(code),
                client_id: pending.clientId,
                client_secret: pending.clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });
        const tokens = await tokenRes.json();
        if (!tokenRes.ok || !tokens.refresh_token) {
            console.error('Google token response:', tokens);
            res.status(400).send('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Não foi possível obter o <strong>refresh token</strong>. Remova o acesso do app em <a href="https://myaccount.google.com/permissions">minha conta Google</a> e tente de novo, ou use o campo manual de Refresh Token nas configurações.</p></body></html>');
            return;
        }
        const existing = loadBackupDriveConfig() || {};
        saveBackupDriveConfig({
            ...existing,
            clientId: pending.clientId,
            clientSecret: pending.clientSecret,
            refreshToken: tokens.refresh_token,
            folderId: pending.folderId || existing.folderId || ''
        });
        res.send('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Drive</title></head><body style="font-family:sans-serif;padding:24px;text-align:center"><p><strong>Google Drive conectado.</strong></p><p>Feche esta janela e volte ao sistema.</p><script>setTimeout(function(){ try { window.close(); } catch(e) {} }, 1500);</script></body></html>');
    } catch (e) {
        console.error(e);
        res.status(500).send('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Erro ao finalizar autorização.</p></body></html>');
    }
});

// POST endpoints
app.post('/api/clientes', (req, res) => {
    const cliente = req.body;
    const endereco = JSON.stringify(cliente.endereco || {});
    // Normalizar veículos garantindo propriedade `ativo` por padrão
    const normalizedVeiculosArray = (cliente.veiculos || []).map(v => {
        const veh = Object.assign({}, v);
        if (veh.ativo === undefined) veh.ativo = true;
        return veh;
    });
    const veiculos = JSON.stringify(normalizedVeiculosArray);
    let possuiIdCustomizado = cliente.id !== undefined && cliente.id !== null && cliente.id !== '';
    let idCustomizado = null;
    if (possuiIdCustomizado) {
        idCustomizado = parseInt(cliente.id);
        if (Number.isNaN(idCustomizado)) {
            possuiIdCustomizado = false;
        }
    }
    
    // Impedir duplicidade de telefone
    db.get('SELECT id FROM clientes WHERE telefone = ?', [cliente.telefone], (err, rowTel) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (rowTel && (!possuiIdCustomizado || rowTel.id !== idCustomizado)) {
            res.status(400).json({ error: 'Já existe um cliente com este telefone.' });
            return;
        }

        // Se tiver ID customizado, verificar se já existe antes de inserir
        if (possuiIdCustomizado) {
            db.get('SELECT id FROM clientes WHERE id = ?', [idCustomizado], (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (row) {
                // Cliente já existe, atualizar em vez de inserir
                db.run(
                    'UPDATE clientes SET nome = ?, telefone = ?, endereco = ?, veiculos = ?, ativo = ? WHERE id = ?',
                    [cliente.nome, cliente.telefone, endereco, veiculos, cliente.ativo !== undefined ? cliente.ativo : 1, idCustomizado],
                    function(updateErr) {
                        if (updateErr) {
                            res.status(500).json({ error: updateErr.message });
                            return;
                        }
                        res.json({ 
                            id: idCustomizado, 
                            ...cliente,
                            endereco: cliente.endereco || {},
                            veiculos: normalizedVeiculosArray
                        });
                    }
                );
            } else {
                // Cliente não existe, inserir normalmente
                db.run(
                    'INSERT INTO clientes (id, nome, telefone, endereco, veiculos, ativo) VALUES (?, ?, ?, ?, ?, ?)',
                    [idCustomizado, cliente.nome, cliente.telefone, endereco, veiculos, cliente.ativo !== undefined ? cliente.ativo : 1],
                    function(insertErr) {
                        if (insertErr) {
                            res.status(500).json({ error: insertErr.message });
                            return;
                        }
                        res.json({ 
                            id: idCustomizado, 
                            ...cliente,
                            endereco: cliente.endereco || {},
                            veiculos: cliente.veiculos || []
                        });
                    }
                );
            }
        });
        } else {
            // Sem ID customizado, inserir normalmente
            db.run(
                'INSERT INTO clientes (nome, telefone, endereco, veiculos, ativo) VALUES (?, ?, ?, ?, ?)',
                [cliente.nome, cliente.telefone, endereco, veiculos, cliente.ativo !== undefined ? cliente.ativo : 1],
                function(err) {
                    if (err) {
                        if (err.message && err.message.includes('UNIQUE')) {
                            res.status(400).json({ error: 'Já existe um cliente com este telefone.' });
                        } else {
                            res.status(500).json({ error: err.message });
                        }
                        return;
                    }
                    const novoId = this.lastID;
                    res.json({ 
                        id: novoId, 
                        ...cliente,
                        endereco: cliente.endereco || {},
                        veiculos: normalizedVeiculosArray
                    });
                }
            );
        }
    });
});

app.post('/api/agendamentos', (req, res) => {
    const agendamento = req.body || {};
    const clienteIdRaw = agendamento.clienteId ?? agendamento.cliente_id;
    const veiculoIdRaw = agendamento.veiculoId ?? agendamento.veiculo_id;
    let possuiIdCustomizado = agendamento.id !== undefined && agendamento.id !== null && agendamento.id !== '';
    let idCustomizado = null;
    if (possuiIdCustomizado) {
        idCustomizado = parseInt(agendamento.id);
        if (Number.isNaN(idCustomizado)) {
            possuiIdCustomizado = false;
        }
    }

    const clienteId = clienteIdRaw !== undefined && clienteIdRaw !== null && clienteIdRaw !== ''
        ? parseInt(clienteIdRaw)
        : null;
    
    // Processar veiculoId - pode ser número ou string
    let veiculoId = null;
    if (veiculoIdRaw !== undefined && veiculoIdRaw !== null && veiculoIdRaw !== '' && veiculoIdRaw !== '0') {
        // Tentar converter para número primeiro
        const veiculoIdNum = parseInt(veiculoIdRaw);
        if (!Number.isNaN(veiculoIdNum) && veiculoIdNum > 0) {
            veiculoId = veiculoIdNum;
        } else {
            // Se não for número válido, manter como string (pode ser ID customizado)
            veiculoId = String(veiculoIdRaw);
        }
    }
    
    const numeroRaw = agendamento.numero;
    const numeroInformado = numeroRaw !== undefined && numeroRaw !== null && numeroRaw !== '';
    const numeroInicial = numeroInformado ? parseInt(numeroRaw) : null;

    if (!clienteId) {
        res.status(400).json({ error: 'clienteId é obrigatório' });
        return;
    }
    
    // Log para debug
    console.log('Processando agendamento:', {
        clienteId,
        veiculoId,
        tipoVeiculoId: typeof veiculoId,
        veiculoIdRaw
    });

    if (!agendamento.data) {
        res.status(400).json({ error: 'Data é obrigatória' });
        return;
    }

    const hora = agendamento.hora || '';
    const problema = agendamento.problema || agendamento.servico || '';
    const observacoes = agendamento.observacoes || '';
    const status = agendamento.status || 'agendado';
    const motivoCancelamento = agendamento.motivoCancelamento ?? agendamento.motivo_cancelamento ?? null;
    const canceladoEm = agendamento.canceladoEm ?? agendamento.cancelado_em ?? null;
    const whatsappEnviado = agendamento.whatsappEnviado || agendamento.whatsapp_enviado ? 1 : 0;
    const lembreteEnviado = agendamento.lembreteEnviado || agendamento.lembrete_enviado ? 1 : 0;
    const dataFinalizacao = agendamento.dataFinalizacao || agendamento.data_finalizacao || null;

    // Checagem idempotente: se foi enviado um `id` customizado e já existe, retornar registro existente
    if (possuiIdCustomizado) {
        db.get('SELECT * FROM agendamentos WHERE id = ?', [idCustomizado], (errExist, rowExist) => {
            if (errExist) {
                res.status(500).json({ error: errExist.message });
                return;
            }
            if (rowExist) {
                res.json({
                    ...rowExist,
                    notificacoes: rowExist.notificacoes ? JSON.parse(rowExist.notificacoes) : []
                });
                return;
            }
            // continuar fluxo normal caso não exista
            proceedAfterIdCheck();
        });
    } else {
        proceedAfterIdCheck();
    }

    function proceedAfterIdCheck() {
        // Heurística anti-duplicação: evitar inserir agendamento igual (cliente+data+hora)
        if (clienteId && agendamento.data) {
            db.get('SELECT * FROM agendamentos WHERE cliente_id = ? AND data = ? AND hora = ? LIMIT 1', [clienteId, agendamento.data, hora], (dupErr, dupRow) => {
                if (dupErr) {
                    res.status(500).json({ error: dupErr.message });
                    return;
                }
                if (dupRow) {
                    res.json({
                        ...dupRow,
                        notificacoes: dupRow.notificacoes ? JSON.parse(dupRow.notificacoes) : []
                    });
                    return;
                }
                // Nenhum duplicado encontrado — prosseguir com lógica de número
                continueNumeroFlow();
            });
        } else {
            continueNumeroFlow();
        }
    }

    const inserirAgendamento = (numeroFinal) => {
        const baseSql = `(
                cliente_id,
                veiculo_id,
                numero,
                data,
                hora,
                problema,
                servico,
                observacoes,
                status,
                whatsapp_enviado,
                lembrete_enviado,
                data_finalizacao,
                motivo_cancelamento,
                cancelado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        let sql;
        if (possuiIdCustomizado) {
            sql = `INSERT INTO agendamentos (id, ${baseSql.slice(1)}`.replace('VALUES (', 'VALUES (?, ');
        } else {
            sql = `INSERT INTO agendamentos ${baseSql}`;
        }

        const params = [
            ...(possuiIdCustomizado ? [idCustomizado] : []),
            clienteId,
            veiculoId, // Já está validado acima, pode ser número ou string
            numeroFinal,
            agendamento.data,
            hora,
            problema,
            problema,
            observacoes,
            status,
            whatsappEnviado,
            lembreteEnviado,
            dataFinalizacao,
            motivoCancelamento,
            canceladoEm
        ];

        console.log('SQL Inserção agendamento:', sql);
        console.log('Params (count):', params.length, params);

        db.run(
            sql,
            params,
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const novoId = possuiIdCustomizado ? idCustomizado : this.lastID;
                console.log('Agendamento inserido com ID:', novoId, 'veiculoId:', veiculoId);
                db.get('SELECT * FROM agendamentos WHERE id = ?', [novoId], (err2, row) => {
                    if (err2 || !row) {
                        console.log('Agendamento não encontrado após inserção, retornando dados criados');
                        res.json({
                            id: novoId,
                            cliente_id: clienteId,
                            veiculo_id: veiculoId, // Já está validado acima
                            numero: numeroFinal,
                            data: agendamento.data,
                            hora,
                            problema,
                            servico: problema,
                            observacoes,
                            status,
                            whatsapp_enviado: whatsappEnviado,
                            lembrete_enviado: lembreteEnviado,
                            data_finalizacao: dataFinalizacao
                        });
                    } else {
                        console.log('Agendamento encontrado no banco:', {
                            id: row.id,
                            veiculo_id: row.veiculo_id,
                            tipo_veiculo_id: typeof row.veiculo_id
                        });
                        res.json({
                            ...row,
                            notificacoes: row.notificacoes ? JSON.parse(row.notificacoes) : []
                        });
                    }
                });
            }
        );
    };

    function continueNumeroFlow() {
        if (!numeroInformado || Number.isNaN(numeroInicial)) {
            db.get('SELECT MAX(numero) AS maxNumero FROM agendamentos', [], (err, row) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                const proximoNumero = row && row.maxNumero !== null && row.maxNumero !== undefined
                    ? row.maxNumero + 1
                    : 0;
                inserirAgendamento(proximoNumero);
            });
        } else {
            inserirAgendamento(numeroInicial);
        }
    }
});

app.post('/api/orcamentos', (req, res) => {
    const orcamento = req.body || {};
    const clienteId = orcamento.clienteId ?? orcamento.cliente_id;
    const veiculoId = orcamento.veiculoId ?? orcamento.veiculo_id;
    const agendamentoId = orcamento.agendamentoId ?? orcamento.agendamento_id;
    let possuiIdCustomizado = orcamento.id !== undefined && orcamento.id !== null && orcamento.id !== '';
    let idCustomizado = null;
    if (possuiIdCustomizado) {
        idCustomizado = parseInt(orcamento.id);
        if (Number.isNaN(idCustomizado)) {
            possuiIdCustomizado = false;
        }
    }

    if (!clienteId) {
        res.status(400).json({ error: 'clienteId é obrigatório' });
        return;
    }

    const servicos = JSON.stringify(orcamento.servicos || []);
    const pecas = JSON.stringify(orcamento.pecas || []);
    const observacoes = orcamento.observacoes || '';
    const validade = orcamento.validade !== undefined ? parseInt(orcamento.validade) : null;
    const dataOrcamento = orcamento.data || new Date().toISOString().split('T')[0];
    const desconto = orcamento.desconto !== undefined ? parseFloat(orcamento.desconto) : 0;
    const total = orcamento.total !== undefined ? parseFloat(orcamento.total) : parseFloat(orcamento.valor_total) || 0;
    const status = orcamento.status || 'pendente';
    const motivoCancelamento = orcamento.motivoCancelamento ?? orcamento.motivo_cancelamento ?? null;
    const canceladoEm = orcamento.canceladoEm ?? orcamento.cancelado_em ?? null;

    const inserirOrcamento = (numeroFinal) => {
        const baseSql = `(
                numero,
                cliente_id,
                veiculo_id,
                agendamento_id,
                servicos,
                pecas,
                observacoes,
                validade,
                data,
                desconto,
                valor_total,
                total,
                status,
                motivo_cancelamento,
                cancelado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        let sql;
        if (possuiIdCustomizado) {
            sql = `INSERT INTO orcamentos (id, ${baseSql.slice(1)}`.replace('VALUES (', 'VALUES (?, ');
        } else {
            sql = `INSERT INTO orcamentos ${baseSql}`;
        }

        const params = [
            ...(possuiIdCustomizado ? [idCustomizado] : []),
            numeroFinal,
            clienteId,
            veiculoId || null,
            agendamentoId || null,
            servicos,
            pecas,
            observacoes,
            validade,
            dataOrcamento,
            desconto,
            total,
            total,
            status,
            motivoCancelamento,
            canceladoEm
        ];

        console.log('SQL Inserção orcamento:', sql);
        console.log('Params (count):', params.length, params);

        db.run(
            sql,
            params,
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                const novoId = possuiIdCustomizado ? idCustomizado : this.lastID;
                db.get('SELECT * FROM orcamentos WHERE id = ?', [novoId], (err2, row) => {
                    if (err2 || !row) {
                        res.json({
                            id: novoId,
                            numero: numeroFinal,
                            cliente_id: clienteId,
                            veiculo_id: veiculoId || null,
                            agendamento_id: agendamentoId || null,
                            observacoes,
                            validade,
                            data: dataOrcamento,
                            desconto,
                            valor_total: total,
                            total,
                            status,
                            servicos: orcamento.servicos || [],
                            pecas: orcamento.pecas || []
                        });
                    } else {
                        res.json({
                            ...row,
                            servicos: row.servicos ? JSON.parse(row.servicos) : [],
                            pecas: row.pecas ? JSON.parse(row.pecas) : []
                        });
                    }
                });
            }
        );
    };

    // Checagem idempotente: se id customizado foi enviado e já existe, retornar o registro existente
    if (possuiIdCustomizado) {
        db.get('SELECT * FROM orcamentos WHERE id = ?', [idCustomizado], (errExist, rowExist) => {
            if (errExist) {
                res.status(500).json({ error: errExist.message });
                return;
            }
            if (rowExist) {
                res.json({
                    ...rowExist,
                    servicos: rowExist.servicos ? JSON.parse(rowExist.servicos) : [],
                    pecas: rowExist.pecas ? JSON.parse(rowExist.pecas) : []
                });
                return;
            }
            proceedOrcamentoAfterIdCheck();
        });
    } else {
        proceedOrcamentoAfterIdCheck();
    }

    function proceedOrcamentoAfterIdCheck() {
        // Heurística anti-duplicação: evitar criar orcamento duplicado (cliente + data + valor_total)
        if (clienteId && dataOrcamento) {
            // Arredondar para 2 casas evita divergência por precisão de float
            db.get('SELECT * FROM orcamentos WHERE cliente_id = ? AND data = ? AND ROUND(valor_total, 2) = ROUND(?, 2) LIMIT 1', [clienteId, dataOrcamento, total], (dupErr, dupRow) => {
                if (dupErr) {
                    res.status(500).json({ error: dupErr.message });
                    return;
                }
                if (dupRow) {
                    res.json({
                        ...dupRow,
                        servicos: dupRow.servicos ? JSON.parse(dupRow.servicos) : [],
                        pecas: dupRow.pecas ? JSON.parse(dupRow.pecas) : []
                    });
                    return;
                }
                // Prosseguir com geração de número
                finishOrcamentoNumeroFlow();
            });
        } else {
            finishOrcamentoNumeroFlow();
        }
    }

    function finishOrcamentoNumeroFlow() {
        if (orcamento.numero === undefined || orcamento.numero === null || orcamento.numero === '') {
            db.get('SELECT MAX(numero) AS maxNumero FROM orcamentos', [], (err, row) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                const proximoNumero = row && row.maxNumero !== null && row.maxNumero !== undefined
                    ? row.maxNumero + 1
                    : 0;
                inserirOrcamento(proximoNumero);
            });
        } else {
            inserirOrcamento(parseInt(orcamento.numero));
        }
    }
});

app.post('/api/ordens-servico', (req, res) => {
    const os = req.body || {};
    const orcamentoId = os.orcamentoId ?? os.orcamento_id;
    const clienteId = os.clienteId ?? os.cliente_id;
    const veiculoId = os.veiculoId ?? os.veiculo_id;
    const agendamentoId = os.agendamentoId ?? os.agendamento_id;
    let possuiIdCustomizado = os.id !== undefined && os.id !== null && os.id !== '';
    let idCustomizado = null;
    if (possuiIdCustomizado) {
        idCustomizado = parseInt(os.id);
        if (Number.isNaN(idCustomizado)) {
            possuiIdCustomizado = false;
        }
    }

    if (!orcamentoId) {
        res.status(400).json({ error: 'orcamentoId é obrigatório' });
        return;
    }

    const servicos = JSON.stringify(os.servicos || []);
    const pecas = JSON.stringify(os.pecas || []);
    const observacoes = os.observacoes || '';
    const status = os.status || 'pendente';
    const dataAbertura = os.dataAbertura || os.data_abertura || new Date().toISOString();
    const dataFinalizacao = os.dataFinalizacao || os.data_finalizacao || null;
    const whatsappEnviado = os.whatsappEnviado || os.whatsapp_enviado ? 1 : 0;

    const inserirOS = (numeroFinal) => {
        const baseSql = `(
                numero,
                orcamento_id,
                cliente_id,
                veiculo_id,
                agendamento_id,
                servicos,
                pecas,
                observacoes,
                status,
                data_abertura,
                data_finalizacao,
                whatsapp_enviado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        let sql;
        if (possuiIdCustomizado) {
            sql = `INSERT INTO ordens_servico (id, ${baseSql.slice(1)}`.replace('VALUES (', 'VALUES (?, ');
        } else {
            sql = `INSERT INTO ordens_servico ${baseSql}`;
        }

        const params = [
            ...(possuiIdCustomizado ? [idCustomizado] : []),
            numeroFinal,
            orcamentoId,
            clienteId || null,
            veiculoId || null,
            agendamentoId || null,
            servicos,
            pecas,
            observacoes,
            status,
            dataAbertura,
            dataFinalizacao,
            whatsappEnviado
        ];

        console.log('SQL Inserção ordens_servico:', sql);
        console.log('Params (count):', params.length, params);

        db.run(
            sql,
            params,
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                const novoId = possuiIdCustomizado ? idCustomizado : this.lastID;
                db.get('SELECT * FROM ordens_servico WHERE id = ?', [novoId], (err2, row) => {
                    if (err2 || !row) {
                        res.json({
                            id: novoId,
                            numero: numeroFinal,
                            orcamento_id: orcamentoId,
                            cliente_id: clienteId || null,
                            veiculo_id: veiculoId || null,
                            agendamento_id: agendamentoId || null,
                            servicos: os.servicos || [],
                            pecas: os.pecas || [],
                            observacoes,
                            status,
                            data_abertura: dataAbertura,
                            data_finalizacao: dataFinalizacao,
                            whatsapp_enviado: whatsappEnviado
                        });
                    } else {
                        res.json({
                            ...row,
                            servicos: row.servicos ? JSON.parse(row.servicos) : [],
                            pecas: row.pecas ? JSON.parse(row.pecas) : []
                        });
                    }
                });
            }
        );
    };

    // Checagem idempotente por id customizado
    if (possuiIdCustomizado) {
        db.get('SELECT * FROM ordens_servico WHERE id = ?', [idCustomizado], (errExist, rowExist) => {
            if (errExist) {
                res.status(500).json({ error: errExist.message });
                return;
            }
            if (rowExist) {
                res.json({
                    ...rowExist,
                    servicos: rowExist.servicos ? JSON.parse(rowExist.servicos) : [],
                    pecas: rowExist.pecas ? JSON.parse(rowExist.pecas) : []
                });
                return;
            }
            proceedOSAfterIdCheck();
        });
    } else {
        proceedOSAfterIdCheck();
    }

    function proceedOSAfterIdCheck() {
        // Heurística anti-duplicação: se já existe OS para o mesmo orcamento, retornar existente
        if (orcamentoId) {
            db.get('SELECT * FROM ordens_servico WHERE orcamento_id = ? LIMIT 1', [orcamentoId], (dupErr, dupRow) => {
                if (dupErr) {
                    res.status(500).json({ error: dupErr.message });
                    return;
                }
                if (dupRow) {
                    res.json({
                        ...dupRow,
                        servicos: dupRow.servicos ? JSON.parse(dupRow.servicos) : [],
                        pecas: dupRow.pecas ? JSON.parse(dupRow.pecas) : []
                    });
                    return;
                }
                finishOSNumeroFlow();
            });
        } else {
            finishOSNumeroFlow();
        }
    }

    function finishOSNumeroFlow() {
        if (os.numero === undefined || os.numero === null || os.numero === '') {
            db.get('SELECT MAX(numero) AS maxNumero FROM ordens_servico', [], (err, row) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                const proximoNumero = row && row.maxNumero !== null && row.maxNumero !== undefined
                    ? row.maxNumero + 1
                    : 1;
                inserirOS(proximoNumero);
            });
        } else {
            inserirOS(parseInt(os.numero));
        }
    }
});

app.post('/api/transacoes', (req, res) => {
    const transacao = req.body || {};
    const orcamentoId = transacao.orcamentoId ?? transacao.orcamento_id;
    const clienteId = transacao.clienteId ?? transacao.cliente_id;
    const categoriaId = transacao.categoriaId ?? transacao.categoria_id;
    const parcelaDe = transacao.parcelaDe ?? transacao.parcela_de;
    let possuiIdCustomizado = transacao.id !== undefined && transacao.id !== null && transacao.id !== '';
    let idCustomizado = null;
    if (possuiIdCustomizado) {
        idCustomizado = parseInt(transacao.id);
        if (Number.isNaN(idCustomizado)) {
            possuiIdCustomizado = false;
        }
    }

    if (!transacao.tipo) {
        res.status(400).json({ error: 'Tipo é obrigatório' });
        return;
    }
    if (!transacao.valor || transacao.valor <= 0) {
        res.status(400).json({ error: 'Valor deve ser maior que zero' });
        return;
    }
    if (!transacao.data) {
        res.status(400).json({ error: 'Data é obrigatória' });
        return;
    }

    const descricao = transacao.descricao || '';
    // Se for contas a pagar e pagamento à vista, status deve ser 'pago'
    let status = transacao.status || 'pendente';
    const tipoTransacao = (transacao.tipo || '').toLowerCase();
    const formaPag = (transacao.formaPagamento || transacao.forma_pagamento || '').toLowerCase();
    if ((tipoTransacao === 'pagar' || tipoTransacao === 'contas a pagar' || tipoTransacao === 'contas_pagar') && formaPag === 'à vista') {
        status = 'pago';
    }
    // Salvar historicoPagamentos dentro de observacoes (JSON)
    let observacoes = transacao.observacoes || '';
    if (transacao.historicoPagamentos) {
        try {
            let obsObj = {};
            if (observacoes && typeof observacoes === 'string') {
                try { obsObj = JSON.parse(observacoes); } catch(e) { obsObj = {}; }
            } else if (typeof observacoes === 'object') {
                obsObj = observacoes;
            }
            obsObj.historicoPagamentos = transacao.historicoPagamentos;
            observacoes = JSON.stringify(obsObj);
        } catch(e) { /* fallback: salva como string normal */ }
    }
    const numeroParcela = transacao.numeroParcela ?? transacao.numero_parcela ?? null;
    const totalParcelas = transacao.totalParcelas ?? transacao.total_parcelas ?? null;
    const isDuplicata = (transacao.isDuplicata ?? transacao.is_duplicata) ? 1 : 0;
    const numeroDuplicata = transacao.numeroDuplicata ?? transacao.numero_duplicata ?? null;
    const formaPagamento = transacao.formaPagamento ?? transacao.forma_pagamento ?? null;
    const parcelado = transacao.parcelado ? 1 : 0;
    const numParcela = transacao.numParcelas ?? transacao.num_parcelas ?? null;
    const confirmadoEm = transacao.confirmadoEm ?? transacao.confirmado_em ?? null;
    const criadoEm = transacao.criadoEm ?? transacao.criado_em ?? new Date().toISOString();

    // Prepara colunas e params
    const cols = [
        'orcamento_id', 'cliente_id', 'categoria_id', 'descricao', 'tipo', 'valor', 'data', 'status',
        'observacoes', 'parcela_de', 'numero_parcela', 'total_parcelas', 'is_duplicata', 'numero_duplicata',
        'forma_pagamento', 'parcelado', 'num_parcelas', 'confirmado_em', 'criado_em'
    ];

    const paramsBase = [
        orcamentoId || null,
        clienteId || null,
        categoriaId || null,
        descricao,
        transacao.tipo,
        transacao.valor,
        transacao.data,
        status,
        observacoes,
        parcelaDe || null,
        numeroParcela,
        totalParcelas,
        isDuplicata,
        numeroDuplicata,
        formaPagamento,
        parcelado,
        numParcela,
        confirmadoEm,
        criadoEm
    ];

    function proceedInsert() {
        const columns = [...cols];
        const params = [...paramsBase];

        if (possuiIdCustomizado) {
            columns.unshift('id');
            params.unshift(idCustomizado);
        }

        const placeholders = '(' + columns.map(() => '?').join(', ') + ')';
        const sql = `INSERT INTO transacoes (${columns.join(', ')}) VALUES ${placeholders}`;

        db.run(sql, params, function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const novoId = possuiIdCustomizado ? idCustomizado : this.lastID;
            db.get('SELECT * FROM transacoes WHERE id = ?', [novoId], (err2, row) => {
                if (err2) {
                    res.status(500).json({ error: err2.message });
                    return;
                }
                if (!row) {
                    res.json({ id: novoId });
                    return;
                }
                res.json({
                    ...row,
                    orcamentoId: row.orcamento_id,
                    clienteId: row.cliente_id,
                    categoriaId: row.categoria_id,
                    parcelaDe: row.parcela_de,
                    numeroParcela: row.numero_parcela,
                    totalParcelas: row.total_parcelas,
                    isDuplicata: row.is_duplicata === 1,
                    numeroDuplicata: row.numero_duplicata,
                    formaPagamento: row.forma_pagamento,
                    parcelado: row.parcelado === 1,
                    numParcela: row.num_parcelas,
                    confirmadoEm: row.confirmado_em,
                    criadoEm: row.criado_em
                });
            });
        });
    }

    preInsertChecks();

    function preInsertChecks() {
        // Se id customizado foi fornecido, retornar registro existente
        if (possuiIdCustomizado) {
            db.get('SELECT * FROM transacoes WHERE id = ?', [idCustomizado], (errExist, rowExist) => {
                if (errExist) {
                    res.status(500).json({ error: errExist.message });
                    return;
                }
                if (rowExist) {
                    res.json({
                        ...rowExist,
                        orcamentoId: rowExist.orcamento_id,
                        clienteId: rowExist.cliente_id,
                        categoriaId: rowExist.categoria_id,
                        parcelaDe: rowExist.parcela_de,
                        numeroParcela: rowExist.numero_parcela,
                        totalParcelas: rowExist.total_parcelas,
                        isDuplicata: rowExist.is_duplicata === 1,
                        numeroDuplicata: rowExist.numero_duplicata,
                        formaPagamento: rowExist.forma_pagamento,
                        parcelado: rowExist.parcelado === 1,
                        numParcela: rowExist.num_parcelas,
                        confirmadoEm: rowExist.confirmado_em,
                        criadoEm: rowExist.criado_em
                    });
                    return;
                }
                // não existe, prosseguir para checagem por orçamento
                checkByOrcamento();
            });
            return;
        }

        // Heurística: evitar duplicar lançamentos idênticos (cliente+tipo+valor+data)
        if (clienteId && transacao.tipo && transacao.valor && transacao.data) {
            db.get('SELECT * FROM transacoes WHERE cliente_id = ? AND tipo = ? AND valor = ? AND data = ? LIMIT 1', [clienteId, transacao.tipo, transacao.valor, transacao.data], (dupErr, dupRow) => {
                if (dupErr) {
                    res.status(500).json({ error: dupErr.message });
                    return;
                }
                if (dupRow) {
                    res.json({
                        ...dupRow,
                        orcamentoId: dupRow.orcamento_id,
                        clienteId: dupRow.cliente_id,
                        categoriaId: dupRow.categoria_id,
                        parcelaDe: dupRow.parcela_de,
                        numeroParcela: dupRow.numero_parcela,
                        totalParcelas: dupRow.total_parcelas,
                        isDuplicata: dupRow.is_duplicata === 1,
                        numeroDuplicata: dupRow.numero_duplicata,
                        formaPagamento: dupRow.forma_pagamento,
                        parcelado: dupRow.parcelado === 1,
                        numParcela: dupRow.num_parcelas,
                        confirmadoEm: dupRow.confirmado_em,
                        criadoEm: dupRow.criado_em
                    });
                    return;
                }
                checkByOrcamento();
            });
            return;
        }

        // Por padrão, checar se existe transacao para o mesmo orcamento
        checkByOrcamento();
    }

    function checkByOrcamento() {
        if (orcamentoId) {
            db.get('SELECT id FROM transacoes WHERE orcamento_id = ? LIMIT 1', [orcamentoId], (errCheck, rowCheck) => {
                if (errCheck) {
                    res.status(500).json({ error: errCheck.message });
                    return;
                }
                if (rowCheck) {
                    res.status(409).json({ error: 'Já existe transação para este orçamento' });
                    return;
                }
                proceedInsert();
            });
        } else {
            proceedInsert();
        }
    }
});

app.post('/api/usuarios', (req, res) => {
    const usuario = req.body;
    
    db.run(
        'INSERT INTO usuarios (nome, email, senha, logo) VALUES (?, ?, ?, ?)',
        [usuario.nome, usuario.email, usuario.senha, usuario.logo],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, ...usuario });
        }
    );
});

// PUT endpoints
app.put('/api/clientes/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const cliente = req.body;
    const endereco = JSON.stringify(cliente.endereco || {});
    // Normalizar veículos garantindo propriedade `ativo` por padrão
    const normalizedVeiculosArray = (cliente.veiculos || []).map(v => {
        const veh = Object.assign({}, v);
        if (veh.ativo === undefined) veh.ativo = true;
        return veh;
    });
    const veiculos = JSON.stringify(normalizedVeiculosArray);
    
    db.run(
        'UPDATE clientes SET nome = ?, telefone = ?, endereco = ?, veiculos = ?, ativo = ? WHERE id = ?',
        [cliente.nome, cliente.telefone, endereco, veiculos, cliente.ativo !== undefined ? cliente.ativo : 1, id],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: 'Cliente não encontrado' });
                return;
            }
            res.json({ id, ...cliente, veiculos: normalizedVeiculosArray });
        }
    );
});

// PATCH endpoint para desativar um veículo dentro do cadastro do cliente
app.patch('/api/clientes/:clienteId/veiculos/:veiculoId/desativar', (req, res) => {
    const clienteId = parseInt(req.params.clienteId);
    const veiculoId = req.params.veiculoId;

    if (Number.isNaN(clienteId)) {
        res.status(400).json({ error: 'clienteId inválido' });
        return;
    }

    db.get('SELECT veiculos FROM clientes WHERE id = ?', [clienteId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Cliente não encontrado' });
            return;
        }

        let vehicles = [];
        try {
            vehicles = row.veiculos ? JSON.parse(row.veiculos) : [];
        } catch (e) {
            vehicles = [];
        }

        const idx = vehicles.findIndex(v => String(v.id) === String(veiculoId));
        if (idx === -1) {
            res.status(404).json({ error: 'Veículo não encontrado para este cliente' });
            return;
        }

        const vehicle = vehicles[idx];
        if (vehicle.ativo === false || vehicle.ativo === 0) {
            res.json({ message: 'Veículo já está desativado', veiculo: vehicle });
            return;
        }

        vehicle.ativo = false;
        vehicle.data_desativacao = new Date().toISOString();

        // Persistir alteração
        const veiculosJson = JSON.stringify(vehicles);
        db.run('UPDATE clientes SET veiculos = ? WHERE id = ?', [veiculosJson, clienteId], function(updateErr) {
            if (updateErr) {
                res.status(500).json({ error: updateErr.message });
                return;
            }
            res.json({ message: 'Veículo desativado com sucesso', veiculo: vehicle });
        });
    });
});

app.put('/api/agendamentos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const agendamento = req.body || {};

    if (Number.isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
    }

    const clienteIdRaw = agendamento.clienteId ?? agendamento.cliente_id;
    const veiculoIdRaw = agendamento.veiculoId ?? agendamento.veiculo_id;
    const numeroRaw = agendamento.numero;

    const clienteId = clienteIdRaw !== undefined && clienteIdRaw !== null && clienteIdRaw !== ''
        ? parseInt(clienteIdRaw)
        : null;
    const veiculoId = veiculoIdRaw !== undefined && veiculoIdRaw !== null && veiculoIdRaw !== ''
        ? parseInt(veiculoIdRaw)
        : null;
    const numero = numeroRaw !== undefined && numeroRaw !== null && numeroRaw !== ''
        ? parseInt(numeroRaw)
        : null;

    if (!clienteId) {
        res.status(400).json({ error: 'clienteId é obrigatório' });
        return;
    }

    if (!agendamento.data) {
        res.status(400).json({ error: 'Data é obrigatória' });
        return;
    }

    const hora = agendamento.hora || '';
    const problema = agendamento.problema || agendamento.servico || '';
    const observacoes = agendamento.observacoes || '';
    const status = agendamento.status || 'agendado';
    const motivoCancelamento = agendamento.motivoCancelamento ?? agendamento.motivo_cancelamento ?? null;
    const canceladoEm = agendamento.canceladoEm ?? agendamento.cancelado_em ?? null;
    const whatsappEnviado = agendamento.whatsappEnviado || agendamento.whatsapp_enviado ? 1 : 0;
    const lembreteEnviado = agendamento.lembreteEnviado || agendamento.lembrete_enviado ? 1 : 0;
    const dataFinalizacao = agendamento.dataFinalizacao || agendamento.data_finalizacao || null;

    db.run(
        `UPDATE agendamentos
         SET cliente_id = ?,
             veiculo_id = ?,
             numero = ?,
             data = ?,
             hora = ?,
             problema = ?,
             servico = ?,
             observacoes = ?,
             status = ?,
             whatsapp_enviado = ?,
             lembrete_enviado = ?,
             data_finalizacao = ?,
             motivo_cancelamento = ?,
             cancelado_em = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            clienteId,
            veiculoId || null,
            numero,
            agendamento.data,
            hora,
            problema,
            problema,
            observacoes,
            status,
            whatsappEnviado,
            lembreteEnviado,
            dataFinalizacao,
            motivoCancelamento,
            canceladoEm,
            id
        ],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: 'Agendamento não encontrado' });
                return;
            }

            db.get('SELECT * FROM agendamentos WHERE id = ?', [id], (err2, row) => {
                if (err2 || !row) {
                    res.json({
                        id,
                        cliente_id: clienteId,
                        veiculo_id: veiculoId || null,
                        numero,
                        data: agendamento.data,
                        hora,
                        problema,
                        servico: problema,
                        observacoes,
                        status,
                        whatsapp_enviado: whatsappEnviado,
                        lembrete_enviado: lembreteEnviado,
                        data_finalizacao: dataFinalizacao
                    });
                } else {
                    res.json({
                        ...row,
                        notificacoes: row.notificacoes ? JSON.parse(row.notificacoes) : []
                    });
                }
            });
        }
    );
});

app.put('/api/orcamentos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const orcamento = req.body || {};

    if (Number.isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
    }

    const clienteId = orcamento.clienteId ?? orcamento.cliente_id;
    const veiculoId = orcamento.veiculoId ?? orcamento.veiculo_id;
    const agendamentoId = orcamento.agendamentoId ?? orcamento.agendamento_id;
    const numero = orcamento.numero !== undefined ? parseInt(orcamento.numero) : null;

    if (!clienteId) {
        res.status(400).json({ error: 'clienteId é obrigatório' });
        return;
    }

    const servicos = JSON.stringify(orcamento.servicos || []);
    const pecas = JSON.stringify(orcamento.pecas || []);
    const observacoes = orcamento.observacoes || '';
    const validade = orcamento.validade !== undefined ? parseInt(orcamento.validade) : null;
    const dataOrcamento = orcamento.data || new Date().toISOString().split('T')[0];
    const desconto = orcamento.desconto !== undefined ? parseFloat(orcamento.desconto) : 0;
    const total = orcamento.total !== undefined ? parseFloat(orcamento.total) : parseFloat(orcamento.valor_total) || 0;
    const status = orcamento.status || 'pendente';
    const statusFinanceiro = orcamento.statusFinanceiro ?? orcamento.status_financeiro ?? null;
    const dataDuplicata = orcamento.dataDuplicata ?? orcamento.data_duplicata ?? null;
    const dataLiquidacao = orcamento.dataLiquidacao ?? orcamento.data_liquidacao ?? null;
    const motivoCancelamento = orcamento.motivoCancelamento ?? orcamento.motivo_cancelamento ?? null;
    const canceladoEm = orcamento.canceladoEm ?? orcamento.cancelado_em ?? null;

    db.run(
        `UPDATE orcamentos
         SET numero = ?,
             cliente_id = ?,
             veiculo_id = ?,
             agendamento_id = ?,
             servicos = ?,
             pecas = ?,
             observacoes = ?,
             validade = ?,
             data = ?,
             desconto = ?,
             valor_total = ?,
             total = ?,
             status = ?,
             status_financeiro = ?,
             data_duplicata = ?,
             data_liquidacao = ?,
             motivo_cancelamento = ?,
             cancelado_em = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            numero,
            clienteId,
            veiculoId || null,
            agendamentoId || null,
            servicos,
            pecas,
            observacoes,
            validade,
            dataOrcamento,
            desconto,
            total,
            total,
            status,
            statusFinanceiro,
            dataDuplicata,
            dataLiquidacao,
            motivoCancelamento,
            canceladoEm,
            id
        ],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: 'Orçamento não encontrado' });
                return;
            }
            db.get('SELECT * FROM orcamentos WHERE id = ?', [id], (err2, row) => {
                if (err2 || !row) {
                    res.json({
                        id,
                        numero,
                        cliente_id: clienteId,
                        veiculo_id: veiculoId || null,
                        agendamento_id: agendamentoId || null,
                        observacoes,
                        validade,
                        data: dataOrcamento,
                        desconto,
                        valor_total: total,
                        total,
                        status,
                        servicos: orcamento.servicos || [],
                        pecas: orcamento.pecas || []
                    });
                } else {
                    res.json({
                        ...row,
                        servicos: row.servicos ? JSON.parse(row.servicos) : [],
                        pecas: row.pecas ? JSON.parse(row.pecas) : []
                    });
                }
            });
        }
    );
});

app.put('/api/ordens-servico/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const os = req.body || {};

    if (Number.isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
    }

    const numero = os.numero !== undefined ? parseInt(os.numero) : null;
    const orcamentoId = os.orcamentoId ?? os.orcamento_id;
    const clienteId = os.clienteId ?? os.cliente_id;
    const veiculoId = os.veiculoId ?? os.veiculo_id;
    const agendamentoId = os.agendamentoId ?? os.agendamento_id;
    const servicos = JSON.stringify(os.servicos || []);
    const pecas = JSON.stringify(os.pecas || []);
    const observacoes = os.observacoes || '';
    const status = os.status || 'pendente';
    const dataAbertura = os.dataAbertura || os.data_abertura || new Date().toISOString();
    const dataFinalizacao = os.dataFinalizacao || os.data_finalizacao || null;
    const whatsappEnviado = os.whatsappEnviado || os.whatsapp_enviado ? 1 : 0;

    db.run(
        `UPDATE ordens_servico
         SET numero = ?,
             orcamento_id = ?,
             cliente_id = ?,
             veiculo_id = ?,
             agendamento_id = ?,
             servicos = ?,
             pecas = ?,
             observacoes = ?,
             status = ?,
             data_abertura = ?,
             data_finalizacao = ?,
             whatsapp_enviado = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            numero,
            orcamentoId,
            clienteId || null,
            veiculoId || null,
            agendamentoId || null,
            servicos,
            pecas,
            observacoes,
            status,
            dataAbertura,
            dataFinalizacao,
            whatsappEnviado,
            id
        ],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: 'Ordem de serviço não encontrada' });
                return;
            }
            db.get('SELECT * FROM ordens_servico WHERE id = ?', [id], (err2, row) => {
                if (err2 || !row) {
                    res.json({
                        id,
                        numero,
                        orcamento_id: orcamentoId,
                        cliente_id: clienteId || null,
                        veiculo_id: veiculoId || null,
                        agendamento_id: agendamentoId || null,
                        servicos: os.servicos || [],
                        pecas: os.pecas || [],
                        observacoes,
                        status,
                        data_abertura: dataAbertura,
                        data_finalizacao: dataFinalizacao,
                        whatsapp_enviado: whatsappEnviado
                    });
                } else {
                    res.json({
                        ...row,
                        servicos: row.servicos ? JSON.parse(row.servicos) : [],
                        pecas: row.pecas ? JSON.parse(row.pecas) : []
                    });
                }
            });
        }
    );
});

// DELETE endpoints
app.delete('/api/clientes/:id', (req, res) => {
    const id = parseInt(req.params.id);
    // Verificar se há agendamento, orçamento ou ordem de serviço atrelados
    db.get('SELECT 1 FROM agendamentos WHERE cliente_id = ? LIMIT 1', [id], (err, agendamento) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (agendamento) {
            res.status(400).json({ error: 'Não é possível excluir: o cliente possui agendamentos vinculados.' });
            return;
        }
        db.get('SELECT 1 FROM orcamentos WHERE cliente_id = ? LIMIT 1', [id], (err2, orcamento) => {
            if (err2) {
                res.status(500).json({ error: err2.message });
                return;
            }
            if (orcamento) {
                res.status(400).json({ error: 'Não é possível excluir: o cliente possui orçamentos vinculados.' });
                return;
            }
            db.get('SELECT 1 FROM ordens_servico WHERE cliente_id = ? LIMIT 1', [id], (err3, os) => {
                if (err3) {
                    res.status(500).json({ error: err3.message });
                    return;
                }
                if (os) {
                    res.status(400).json({ error: 'Não é possível excluir: o cliente possui ordens de serviço vinculadas.' });
                    return;
                }
                // Hard delete
                db.run('DELETE FROM clientes WHERE id = ?', [id], function(err4) {
                    if (err4) {
                        res.status(500).json({ error: err4.message });
                        return;
                    }
                    if (this.changes === 0) {
                        res.status(404).json({ error: 'Cliente não encontrado' });
                        return;
                    }
                    res.json({ message: 'Cliente removido com sucesso' });
                });
            });
        });
    });
});

app.delete('/api/agendamentos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    
    db.run('DELETE FROM agendamentos WHERE id = ?', [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Agendamento não encontrado' });
            return;
        }
        res.json({ message: 'Agendamento removido com sucesso' });
    });
});

app.delete('/api/orcamentos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    
    db.run('DELETE FROM orcamentos WHERE id = ?', [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Orçamento não encontrado' });
            return;
        }
        res.json({ message: 'Orçamento removido com sucesso' });
    });
});

app.delete('/api/ordens-servico/:id', (req, res) => {
    const id = parseInt(req.params.id);
    
    db.run('DELETE FROM ordens_servico WHERE id = ?', [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Ordem de serviço não encontrada' });
            return;
        }
        res.json({ message: 'Ordem de serviço removida com sucesso' });
    });
});

app.put('/api/transacoes/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const transacao = req.body || {};

    if (Number.isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
    }

    const orcamentoId = transacao.orcamentoId ?? transacao.orcamento_id;
    const clienteId = transacao.clienteId ?? transacao.cliente_id;
    const categoriaId = transacao.categoriaId ?? transacao.categoria_id;
    const parcelaDe = transacao.parcelaDe ?? transacao.parcela_de;
    const descricao = transacao.descricao || '';
    const tipo = transacao.tipo || 'receita';
    const valor = transacao.valor || 0;
    const data = transacao.data || new Date().toISOString().split('T')[0];
    const status = transacao.status || 'pendente';
    // Salvar historicoPagamentos dentro de observacoes (JSON)
    let observacoes = transacao.observacoes || '';
    if (transacao.historicoPagamentos) {
        try {
            let obsObj = {};
            if (observacoes && typeof observacoes === 'string') {
                try { obsObj = JSON.parse(observacoes); } catch(e) { obsObj = {}; }
            } else if (typeof observacoes === 'object') {
                obsObj = observacoes;
            }
            obsObj.historicoPagamentos = transacao.historicoPagamentos;
            observacoes = JSON.stringify(obsObj);
        } catch(e) { /* fallback: salva como string normal */ }
    }
    const numeroParcela = transacao.numeroParcela ?? transacao.numero_parcela ?? null;
    const totalParcelas = transacao.totalParcelas ?? transacao.total_parcelas ?? null;
    const isDuplicata = transacao.isDuplicata ?? transacao.is_duplicata ? 1 : 0;
    const numeroDuplicata = transacao.numeroDuplicata ?? transacao.numero_duplicata ?? null;
    const formaPagamento = transacao.formaPagamento ?? transacao.forma_pagamento ?? null;
    const parcelado = transacao.parcelado ? 1 : 0;
    const numParcelas = transacao.numParcelas ?? transacao.num_parcelas ?? null;
    const confirmadoEm = transacao.confirmadoEm ?? transacao.confirmado_em ?? null;
    const criadoEm = transacao.criadoEm ?? transacao.criado_em ?? null;

    db.run(
        `UPDATE transacoes
         SET orcamento_id = ?,
             cliente_id = ?,
             categoria_id = ?,
             descricao = ?,
             tipo = ?,
             valor = ?,
             data = ?,
             status = ?,
             observacoes = ?,
             parcela_de = ?,
             numero_parcela = ?,
             total_parcelas = ?,
             is_duplicata = ?,
             numero_duplicata = ?,
             forma_pagamento = ?,
             parcelado = ?,
             num_parcelas = ?,
             confirmado_em = ?,
             criado_em = ?
         WHERE id = ?`,
        [
            orcamentoId || null,
            clienteId || null,
            categoriaId || null,
            descricao,
            tipo,
            valor,
            data,
            status,
            observacoes,
            parcelaDe || null,
            numeroParcela,
            totalParcelas,
            isDuplicata,
            numeroDuplicata,
            formaPagamento,
            parcelado,
            numParcelas,
            confirmadoEm,
            criadoEm,
            id
        ],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: 'Transação não encontrada' });
                return;
            }
            db.get('SELECT * FROM transacoes WHERE id = ?', [id], (err2, row) => {
                if (err2 || !row) {
                    res.json({
                        id,
                        orcamentoId: orcamentoId || null,
                        clienteId: clienteId || null,
                        categoriaId: categoriaId || null,
                        descricao,
                        tipo,
                        valor,
                        data,
                        status,
                        observacoes,
                        parcelaDe: parcelaDe || null,
                        numeroParcela,
                        totalParcelas,
                        isDuplicata: isDuplicata === 1,
                        numeroDuplicata,
                        formaPagamento,
                        parcelado: parcelado === 1,
                        numParcelas,
                        confirmadoEm,
                        criadoEm
                    });
                } else {
                    res.json({
                        ...row,
                        orcamentoId: row.orcamento_id,
                        clienteId: row.cliente_id,
                        categoriaId: row.categoria_id,
                        parcelaDe: row.parcela_de,
                        numeroParcela: row.numero_parcela,
                        totalParcelas: row.total_parcelas,
                        isDuplicata: row.is_duplicata === 1,
                        numeroDuplicata: row.numero_duplicata,
                        formaPagamento: row.forma_pagamento,
                        parcelado: row.parcelado === 1,
                        numParcelas: row.num_parcelas,
                        confirmadoEm: row.confirmado_em,
                        criadoEm: row.criado_em
                    });
                }
            });
        }
    );
});

app.delete('/api/transacoes/:id', (req, res) => {
    const id = parseInt(req.params.id);
    
    db.run('DELETE FROM transacoes WHERE id = ?', [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Transação não encontrada' });
            return;
        }
        res.json({ message: 'Transação removida com sucesso' });
    });
});

// Fechar conexão do banco ao encerrar o servidor
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexão com o banco de dados fechada.');
        process.exit(0);
    });
});

// Endpoints para limpeza/backup genérico (admin)
// Construir mapa interno a partir da configuração `CLEANUP_MODULES` (mantém compatibilidade)
const cleanupModuleMap = (() => {
    const m = {};
    for (const key of Object.keys(CLEANUP_MODULES)) {
        const cfg = CLEANUP_MODULES[key] || {};
        m[key] = {
            table: cfg.table || key,
            dateCol: cfg.dateField || cfg.date || 'data',
            labelCols: Array.isArray(cfg.columns) ? cfg.columns.map(c => c.name) : ['id']
        };
    }
    // Mapear aliases úteis
    if (!m['transacoes'] && m['transacoes'] === undefined) {
        m['transacoes'] = { table: 'transacoes', dateCol: 'data', labelCols: ['descricao'] };
    }
    // tornar receber/pagar aliases para transacoes
    m['receber'] = m['receber'] || m['transacoes'];
    m['pagar'] = m['pagar'] || m['transacoes'];
    // adicionar ordens_servico alias se existir configuração similar
    if (!m['ordens_servico'] && m['agendamentos']) {
        m['ordens_servico'] = { table: m['agendamentos'].table, dateCol: m['agendamentos'].dateCol, labelCols: m['agendamentos'].labelCols };
        m['ordens-servico'] = m['ordens_servico'];
    }
    return m;
})();

function normalizeModuleName(name) {
    if (!name) return null;
    const n = String(name).toLowerCase().trim();
    if (cleanupModuleMap[n]) return n;
    const alt = n.replace(/\s+/g, '_').replace(/-/g, '_').replace(/ç/g,'c');
    if (cleanupModuleMap[alt]) return alt;
    // keyword based mapping for human-readable labels
    if (n.includes('ordem') || n.includes('os') || n.includes('servico') || n.includes('serviço')) return 'ordens_servico';
    if (n.includes('orcament')) return 'orcamentos';
    if (n.includes('cliente')) return 'clientes';
    if (n.includes('agend')) return 'agendamentos';
    if (n.includes('receber') || n.includes('receb')) return 'receber';
    if (n.includes('pagar')) return 'pagar';
    if (n.includes('transac') || n.includes('transa')) return 'transacoes';
    // try singular/plural variations
    if (cleanupModuleMap[n + 's']) return n + 's';
    return null;
}


app.post('/api/cleanup/list-records', (req, res) => {
    const { module, fromDate, toDate } = req.body || {};

    // Auth admin
    const cookieHeader = req.headers.cookie || '';
    const cookieToken = (cookieHeader.match(/(?:^|; )admin_token=([^;]+)/) || [])[1];

    if (!cookieToken || !adminTokens.has(cookieToken)) {
        return res.status(403).json({ error: 'Acesso negado' });
    }

    // Validar módulo (aceitar nomes humanizados via normalizeModuleName)
    const modKey = normalizeModuleName(module) || module;
    const config = CLEANUP_MODULES[modKey];
    if (!config) {
        return res.status(400).json({ error: 'Módulo inválido' });
    }

    const { table, dateField, columns } = config;

    // Montar colunas com alias
    const selectColumns = [
        'id',
        `${dateField} AS data`,
        ...columns.map(c => `${c.name} AS ${c.alias}`)
    ].join(', ');

    // Where
    let where = '';
    let params = [];

    if (fromDate && toDate) {
        where = `WHERE ${dateField} BETWEEN ? AND ?`;
        params = [fromDate, toDate];
    } else if (toDate) {
        where = `WHERE ${dateField} <= ?`;
        params = [toDate];
    }

    const sql = `
        SELECT ${selectColumns}
        FROM ${table}
        ${where}
        ORDER BY ${dateField} DESC
        LIMIT 100
    `;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Cleanup list error:', err);
            return res.status(500).json({ error: 'Erro ao listar registros' });
        }

        res.json({
            module: modKey,
            records: rows || []
        });
    });
});

app.post('/api/cleanup/delete-records', (req, res) => {
    const { module, ids, recordIds, confirm } = req.body || {};

    // Autenticação: aceitar cookie admin_token ou header x-admin-password
    const cookieHeader = req.headers.cookie || '';
    const cookieToken = (cookieHeader.match(/(?:^|; )admin_token=([^;]+)/) || [])[1];
    const adminPassEnv = process.env.ADMIN_PASSWORD;
    const providedPass = req.headers['x-admin-password'];
    let authorized = false;
    if (adminPassEnv && providedPass && providedPass === adminPassEnv) authorized = true;
    if (cookieToken && adminTokens.has(cookieToken)) authorized = true;
    if (!authorized) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem deletar registros.' });
    }

    // aceitar tanto `ids` quanto `recordIds` enviados pelo frontend
    const idsArr = Array.isArray(ids) ? ids : Array.isArray(recordIds) ? recordIds : null;

    const modKey = normalizeModuleName(module);
    if (!modKey) {
        return res.status(400).json({ error: 'Módulo inválido' });
    }
    const cfg = cleanupModuleMap[modKey];
    if (!cfg) {
        return res.status(400).json({ error: 'Módulo não suportado para limpeza' });
    }

    if (!idsArr || idsArr.length === 0) {
        return res.status(400).json({ error: 'IDs obrigatórios' });
    }

    // exigir confirmação explícita: true ou string 'DELETE'
    const confirmed = confirm === true || (typeof confirm === 'string' && confirm.toUpperCase() === 'DELETE');
    if (!confirmed) {
        return res.status(400).json({ error: 'Confirmação obrigatória. Envie { confirm: true } ou confirm: "DELETE"' });
    }

    const table = cfg.table;
    const placeholders = idsArr.map(() => '?').join(',');
    const selectSql = `SELECT * FROM ${table} WHERE id IN (${placeholders})`;

    db.all(selectSql, idsArr, (err, rows) => {
        if (err) {
            console.error('Erro cleanup select for delete:', err);
            res.status(500).json({ error: err.message });
            return;
        }

        // salvar backup
        try {
            const fs = require('fs');
            const path = require('path');
            const backupsDir = path.join(__dirname, 'backups');
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);
            const ts = new Date().toISOString().replace(/[:.]/g,'-');
            const fname = path.join(backupsDir, `${table}-backup-${ts}.json`);
            fs.writeFileSync(fname, JSON.stringify({ module: modKey, ids: idsArr, rows, created_at: new Date().toISOString() }, null, 2));
        } catch (e) {
            console.warn('Falha ao escrever backup:', e);
        }
        const deleteSql = `DELETE FROM ${table} WHERE id IN (${placeholders})`;
        db.run(deleteSql, idsArr, function(err2) {
            if (err2) {
                console.error('Erro cleanup delete:', err2);
                res.status(500).json({ error: err2.message });
                return;
            }
            res.json({ deleted: this.changes || 0, backupRows: rows.length });
        });
    });
});

// NOTE: Removed data.json dual-persistence. SQLite (`transacoes`) is the single source of truth.

// Helper para normalizar campos de um registro financeiro antes de enviar ao cliente
function normalizeFinanceiroRow(row) {
    const out = { ...row };
    // Extrair historicoPagamentos de observacoes (JSON)
    out.historicoPagamentos = (() => {
        if (!row.observacoes) return [];
        try {
            const obs = typeof row.observacoes === 'string' ? JSON.parse(row.observacoes) : row.observacoes;
            if (obs && Array.isArray(obs.historicoPagamentos)) return obs.historicoPagamentos;
        } catch(e) {}
        return [];
    })();
    try {
        // Normalizar valor (converter strings formatadas em número)
        if (out.valor !== undefined && out.valor !== null) {
            if (typeof out.valor === 'string') {
                let s = out.valor.trim();
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
                if (!Number.isNaN(n)) out.valor = n;
            } else {
                out.valor = Number(out.valor);
            }
        }

        // Normalizar vencimento (aceitar dd/mm/yyyy)
        if (out.vencimento) {
            const v = String(out.vencimento).trim();
            const dmY = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/;
            if (dmY.test(v)) {
                const m = v.match(dmY);
                out.vencimento = `${m[3]}-${m[2]}-${m[1]}`;
            } else {
                const d = new Date(v);
                if (!Number.isNaN(d.getTime())) out.vencimento = d.toISOString().split('T')[0];
            }
        }
    } catch (e) {
        // se falhar, retorna row sem alterações
        return row;
    }
    return out;
}

// Página utilitária: limpar itens específicos no localStorage do navegador
// Uso: acesse http://localhost:3000/clear-local-storage no navegador para executar
app.get('/clear-local-storage', (req, res) => {
    const idsToRemove = [
        '1765904617785635',
        '1765904617785636',
        '17653351286895xxttqsq4',
        '1765335128730czorj79yb'
    ];

    const idsJson = JSON.stringify(idsToRemove).replace(/'/g, "\\'");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Limpar LocalStorage</title></head><body>
    <h3>Limpar LocalStorage — rodando script</h3>
    <pre id="out">Executando...</pre>
    <script>
        (function(){
            try {
                const keys = ['financeiro-receber','financeiro-pagar','financeiro-sync-queue','financeiro-sync-queue-failed'];
                const out = document.getElementById('out');
                function log(s){ out.textContent += '\n' + s; console.log(s); }
                // backup to window for possible manual copy
                const backup = {};
                keys.forEach(k => backup[k] = localStorage.getItem(k));
                window._localStorageBackup = backup;
                log('Backup salvo em window._localStorageBackup');

                const ids = JSON.parse('${idsJson}');
                ids.forEach(id => {
                    keys.forEach(k => {
                        try {
                            let arr = JSON.parse(localStorage.getItem(k) || '[]');
                            const before = arr.length;
                            arr = arr.filter(x => {
                                try { return !(String(x.id) === String(id) || JSON.stringify(x).indexOf(String(id)) !== -1); } catch(e){ return true; }
                            });
                            localStorage.setItem(k, JSON.stringify(arr));
                            if (before !== arr.length) log('Removed id ' + id + ' from ' + k + ': ' + before + ' -> ' + arr.length);
                        } catch(e) { log('Erro ao processar ' + k + ': ' + e); }
                    });
                });

                log('Remoção concluída — recarregando...');
                setTimeout(()=>{ location.href = '/public/modulo-financeiro.html#receber'; }, 1200);
            } catch(e){ document.getElementById('out').textContent = 'Erro: ' + e; }
        })();
    </script>
    </body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// ========== ROTAS COM ID ESPECÍFICO (PUT, DELETE) - VÊM ANTES DA ROTA :tipo ==========

// PUT update financial entry (contas a receber: exige senha admin ou sessão admin)
app.put('/api/financeiro/:id', (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const entrada = req.body || {};
    console.log(`PUT /api/financeiro/${req.params.id} recebido. body:`, entrada);

    if (Number.isNaN(id)) {
        res.status(400).json({ error: 'ID inválido' });
        return;
    }

    db.get('SELECT * FROM transacoes WHERE id = ?', [id], (getErr, currentRecord) => {
        if (getErr) {
            res.status(500).json({ error: getErr.message });
            return;
        }
        if (!currentRecord) {
            console.warn(`Registro não encontrado no DB para id=${id}`);
            res.status(404).json({ error: 'Registro não encontrado', id: String(id) });
            return;
        }

        const tipoRow = (currentRecord.tipo || '').toLowerCase();
        if (tipoRow === 'receber' && !verifyAdminPasswordOrCookie(req)) {
            res.status(403).json({ error: 'É necessária a senha do administrador para editar contas a receber.' });
            return;
        }

        const wantsPago = (entrada.status || '').toLowerCase() === 'pago';

        if (wantsPago) {
            const numeroParcela = currentRecord.numero_parcela;
            if (numeroParcela && numeroParcela > 1) {
                const parcelaAnterior = numeroParcela - 1;
                const grupoParcelamentoId = currentRecord.grupo_parcelamento_id || currentRecord.grupoParcelamentoId;
                const orcamentoId = currentRecord.orcamento_id || currentRecord.orcamentoId;

                let queryParcelaAnterior = 'SELECT id, status FROM transacoes WHERE numero_parcela = ? AND ';
                let paramsParcelaAnterior = [parcelaAnterior];

                if (grupoParcelamentoId) {
                    queryParcelaAnterior += 'grupo_parcelamento_id = ?';
                    paramsParcelaAnterior.push(grupoParcelamentoId);
                } else if (orcamentoId) {
                    queryParcelaAnterior = 'SELECT id, status FROM transacoes WHERE numero_parcela = ? AND orcamento_id = ?';
                    paramsParcelaAnterior = [parcelaAnterior, orcamentoId];
                } else {
                    queryParcelaAnterior += 'cliente_id = ?';
                    paramsParcelaAnterior.push(currentRecord.cliente_id);
                }

                db.get(queryParcelaAnterior, paramsParcelaAnterior, (parcelErr, parcelaAnteriorRecord) => {
                    if (parcelErr) {
                        res.status(500).json({ error: parcelErr.message });
                        return;
                    }

                    if (parcelaAnteriorRecord && (parcelaAnteriorRecord.status || '').toLowerCase() !== 'pago') {
                        res.status(409).json({
                            error: 'Não é possível liquidar esta parcela. A parcela anterior ainda não foi totalmente paga.',
                            details: {
                                mensagem: `Parcela ${parcelaAnterior} deve ser paga antes de liquidar a parcela ${numeroParcela}`,
                                parcelaAnterior: parcelaAnterior,
                                statusParcelaAnterior: parcelaAnteriorRecord.status
                            }
                        });
                        return;
                    }

                    proceedWithUpdate();
                });
            } else {
                proceedWithUpdate();
            }
        } else {
            proceedWithUpdate();
        }

        function proceedWithUpdate() {
            const m = mergeFinanceiroUpdate(entrada, currentRecord);
            const sql = `UPDATE transacoes SET 
                    status = ?,
                    descricao = ?,
                    observacoes = ?,
                    data_pagamento = ?,
                    fornecedor = ?,
                    grupo_parcelamento_id = ?,
                    valor = ?,
                    vencimento = ?,
                    data = ?,
                    desconto = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`;

            const params = [
                m.status,
                m.descricao,
                m.observacoes,
                m.dataPagamento || null,
                m.fornecedor || null,
                m.grupoParcelamentoId || null,
                m.valor,
                m.vencimento || null,
                m.data || null,
                m.desconto,
                id
            ];

            db.run(sql, params, function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                if (this.changes === 0) {
                    res.status(404).json({ error: 'Registro não encontrado' });
                    return;
                }
                res.json({
                    id: String(id),
                    ...entrada,
                    status: m.status,
                    descricao: m.descricao,
                    observacoes: m.observacoes,
                    dataPagamento: m.dataPagamento,
                    valor: m.valor,
                    vencimento: m.vencimento,
                    data: m.data,
                    desconto: m.desconto,
                    descontoAVista: m.desconto
                });
            });
        }
    });
});

// ========== ROTAS GENÉRICAS COM PARÂMETRO :tipo - VÊM DEPOIS DAS ROTAS :id ==========
// NOTA: Esta rota deve vir DEPOIS das rotas de ID específicas para evitar conflito
app.get('/api/financeiro/:tipo', (req, res) => {
    const tipo = req.params.tipo;
    if (!['receber', 'pagar'].includes(tipo)) {
        // Se não for receber ou pagar, deixar passar para próximas rotas
        // Retornar 404 apenas se for chamada
        res.status(400).json({ error: 'Tipo deve ser "receber" ou "pagar"' });
        return;
    }
    
    db.all(`SELECT 
        id, descricao, tipo, valor, data, status, orcamento_id, cliente_id, 
        numero_parcela, total_parcelas, forma_pagamento, vencimento, data_pagamento,
        observacoes, created_at, updated_at, grupo_parcelamento_id, fornecedor
    FROM transacoes 
    WHERE tipo = ? 
    ORDER BY vencimento DESC`, [tipo], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
            const dados = rows.map(row => ({
            id: row.id ? String(row.id) : null,
            descricao: row.descricao,
            tipo: row.tipo,
            valor: row.valor,
            data: row.data,
            status: row.status,
            orcamentoId: row.orcamento_id,
            clienteId: row.cliente_id,
            numeroParcela: row.numero_parcela,
            totalParcelas: row.total_parcelas,
            formaPagamento: row.forma_pagamento,
            vencimento: row.vencimento,
            dataPagamento: row.data_pagamento,
            observacoes: row.observacoes,
            createdAt: row.created_at,
            grupoParcelamentoId: row.grupo_parcelamento_id,
            fornecedor: row.fornecedor
        }));
        res.json(dados);
    });
});

// POST save financial entry
app.post('/api/financeiro', (req, res) => {
    const entrada = req.body;
    // Log do corpo recebido para depuração
    console.log('POST /api/financeiro recebido:', JSON.stringify(entrada));
    // Normalizar campos comuns para aceitar formatos como "100,00" e datas em "dd/mm/yyyy"
    try {
        // Normalizar tipo
        if (entrada && entrada.tipo) {
            entrada.tipo = String(entrada.tipo).toLowerCase();
        }

        // Normalizar valor: aceitar strings com vírgula, símbolos (R$), e separadores de milhares
        if (entrada && entrada.valor !== undefined && entrada.valor !== null) {
            if (typeof entrada.valor === 'string') {
                let s = String(entrada.valor).trim();
                // Remover símbolo de moeda e espaços
                s = s.replace(/\s/g, '');
                s = s.replace(/R\$|r\$/g, '');
                // Se tiver tanto '.' quanto ',' assumimos que '.' é separador de milhares e ',' decimal
                if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
                    s = s.replace(/\./g, ''); // remover milhares
                    s = s.replace(/,/g, '.'); // tornar decimal
                } else {
                    // Se houver apenas vírgula, trocar por ponto
                    if (s.indexOf(',') !== -1) s = s.replace(/,/g, '.');
                    // se houver apenas pontos, mantemos (assume ponto decimal)
                }
                // Remover quaisquer caracteres restantes que não sejam dígitos ou ponto/menos
                s = s.replace(/[^0-9.-]/g, '');
                const num = Number(s);
                if (!Number.isNaN(num)) entrada.valor = num;
            } else {
                // já número
                entrada.valor = Number(entrada.valor);
            }
        }

        // Normalizar vencimento: aceitar dd/mm/yyyy ou yyyy-mm-dd
        if (entrada && entrada.vencimento) {
            const v = String(entrada.vencimento).trim();
            // formato dd/mm/yyyy
            const dmY = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/;
            if (dmY.test(v)) {
                const m = v.match(dmY);
                entrada.vencimento = `${m[3]}-${m[2]}-${m[1]}`;
            } else {
                // tentar converter data ISO ou outras representações
                const d = new Date(v);
                if (!Number.isNaN(d.getTime())) {
                    entrada.vencimento = d.toISOString().split('T')[0];
                }
            }
        }

        // NOVO: Se for à vista, status = 'pago'
        if (entrada && entrada.formaPagamento) {
            const fp = String(entrada.formaPagamento).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
            if (fp === 'avista' || fp === 'a vista' || fp === 'à vista') {
                entrada.status = 'pago';
            }
        }
    } catch (normErr) {
        console.warn('Erro ao normalizar entrada /api/financeiro:', normErr.message);
    }
    
    if (!entrada.tipo || !['receber', 'pagar'].includes(entrada.tipo)) {
        res.status(400).json({ error: 'Tipo deve ser "receber" ou "pagar"' });
        return;
    }
    if (!entrada.valor || entrada.valor <= 0) {
        res.status(400).json({ error: 'Valor deve ser maior que zero' });
        return;
    }
    if (!entrada.vencimento) {
        res.status(400).json({ error: 'Vencimento é obrigatório' });
        return;
    }

    // Verificar duplicação: apenas uma entrada por orcamento_id
    // OBS: não aplicar verificação para lançamentos parcelados, pois um orçamento pode gerar múltiplas parcelas
    if (entrada.orcamentoId) {
        const isParcelado = entrada.parcelado === true || entrada.parcelado === 1 || entrada.parcelado === '1' || String(entrada.parcelado).toLowerCase() === 'true';
        if (isParcelado) {
            // Para parcelados, permitir inserção de múltiplos registros para o mesmo orçamento
            inserirEntrada();
        } else {
            db.get(`SELECT id FROM transacoes WHERE orcamento_id = ? AND tipo = ? AND status IN ('aberto', 'atrasado')`,
                [entrada.orcamentoId, entrada.tipo],
                (err, row) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    if (row) {
                        res.status(409).json({ error: `Já existe um ${entrada.tipo} aberto para este orçamento` });
                        return;
                    }
                    inserirEntrada();
                }
            );
        }
    } else {
        inserirEntrada();
    }

    function inserirEntrada() {
        const sql = `INSERT INTO transacoes (
            tipo, valor, descricao, status, data, vencimento, 
            orcamento_id, cliente_id, observacoes, forma_pagamento, criado_em, grupo_parcelamento_id, fornecedor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            entrada.tipo,
            entrada.valor,
            entrada.descricao || '',
            entrada.status || 'aberto',
            entrada.data || new Date().toISOString().split('T')[0],
            entrada.vencimento,
            entrada.orcamentoId || null,
            entrada.clienteId || null,
            entrada.observacoes || '',
            entrada.formaPagamento || '',
            new Date().toISOString(),
            entrada.grupoParcelamentoId || null,
            entrada.fornecedor || entrada.fornecedorNome || entrada.fornecedor_nome || null
        ];

        db.run(sql, params, function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            const id = String(this.lastID);
            const novoRegistro = { 
                id,
                ...entrada,
                createdAt: new Date().toISOString()
            };
            
            // Retornar o registro recém-inserido a partir do banco (fonte da verdade)
            db.get('SELECT * FROM transacoes WHERE id = ?', [id], (getErr, row) => {
                if (getErr) {
                    res.status(201).json({ id, ...entrada });
                    return;
                }
                const mapped = {
                    ...row,
                    id: String(row.id),
                    orcamentoId: row.orcamento_id,
                    clienteId: row.cliente_id,
                    formaPagamento: row.forma_pagamento,
                    dataPagamento: row.data_pagamento,
                    grupoParcelamentoId: row.grupo_parcelamento_id
                };
                res.status(201).json(normalizeFinanceiroRow(mapped));
            });
        });
    }
});

inicializarBanco();

function startServer() {
  return app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

module.exports = { startServer };
