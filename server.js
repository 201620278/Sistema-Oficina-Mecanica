const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = 3000;

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
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

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
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite local em:', dbPath);
        inicializarBanco();
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
            telefone TEXT,
            endereco TEXT,
            veiculos TEXT,
            ativo INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

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
            'ALTER TABLE agendamentos ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
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
            'ALTER TABLE orcamentos ADD COLUMN data_liquidacao TEXT'
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

// Endpoint seguro para limpar registros antigos do módulo financeiro
// Requisitos de segurança:
// - body.beforeDate (YYYY-MM-DD) obrigatório
// - body.confirm === true
// - Se variável de ambiente ADMIN_PASSWORD definida, header 'x-admin-password' deve corresponder
app.post('/api/financeiro/cleanup', (req, res) => {
    const { beforeDate, confirm, tipo } = req.body || {};

    if (!beforeDate) {
        res.status(400).json({ error: 'beforeDate é obrigatório (YYYY-MM-DD)' });
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
    let whereClause = '(vencimento IS NOT NULL AND vencimento <= ?) OR (data IS NOT NULL AND data <= ?)';
    let params = [beforeDate, beforeDate];
    
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
            res.json({ deleted: 0, backup: null, message: 'Nenhum registro encontrado antes da data informada' });
            return;
        }

        // Garantir diretório de backup
        const backupsDir = path.join(__dirname, 'backups');
        try {
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);
        } catch (mkdirErr) {
            console.error('Erro ao criar pasta de backups:', mkdirErr.message);
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
            res.json({ deleted: 0, backup: path.relative(__dirname, backupPath), removedItems: [] });
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
            res.json({ deleted: this.changes, backup: path.relative(__dirname, backupPath), removedIds: ids, removedItems });
        });
    });
});

// Admin login endpoints (master login)
// Credenciais pré-configuradas do administrador do sistema
const ADMIN_USERNAME = 'Cicero Diego';
const ADMIN_PASSWORD_HARDCODED = 'Pdb100623@';

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
                    res.status(500).json({ error: err.message });
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
    const status = agendamento.status || 'pendente';
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
                data_finalizacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
            dataFinalizacao
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
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
            status
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
            db.get('SELECT * FROM orcamentos WHERE cliente_id = ? AND data = ? AND valor_total = ? LIMIT 1', [clienteId, dataOrcamento, total], (dupErr, dupRow) => {
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
    const observacoes = transacao.observacoes || '';
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
    const status = agendamento.status || 'pendente';
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
    
    // Soft delete - marcar como inativo
    db.run('UPDATE clientes SET ativo = 0 WHERE id = ?', [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Cliente não encontrado' });
            return;
        }
        res.json({ message: 'Cliente removido com sucesso' });
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
    const observacoes = transacao.observacoes || '';
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

// Endpoints para dados financeiros (receber/pagar)
// GET all financial data
app.get('/api/financeiro', (req, res) => {
    console.log('GET /api/financeiro chamado');
    db.all(`SELECT 
        id, descricao, tipo, valor, data, status, orcamento_id, cliente_id, 
        numero_parcela, total_parcelas, forma_pagamento, vencimento, data_pagamento,
        observacoes, created_at, updated_at, fornecedor
    FROM transacoes 
    WHERE tipo IN ('receber', 'pagar') 
    ORDER BY data DESC`, [], (err, rows) => {
        console.log('db.all callback chamado, err:', err, 'rows length:', rows ? rows.length : 'null');
        if (err) {
            console.error('Erro ao buscar do SQLite:', err.message);
            res.status(500).json({ error: 'Erro interno ao buscar registros' });
            return;
        }

        // Converter IDs para string e normalizar valores/vencimentos
        const dados = rows.map(row => {
            try {
                const mapped = {
                    ...row,
                    id: String(row.id),
                    orcamentoId: row.orcamento_id,
                    clienteId: row.cliente_id,
                    formaPagamento: row.forma_pagamento,
                    dataPagamento: row.data_pagamento,
                    grupoParcelamentoId: row.grupo_parcelamento_id,
                    fornecedor: row.fornecedor
                };
                return normalizeFinanceiroRow(mapped);
            } catch (e) {
                console.error('Erro ao normalizar row:', e, row);
                return row;
            }
        });

        console.log('Enviando resposta com', dados.length, 'registros');
        res.json(dados);
    });
});

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

// PUT update financial entry
app.put('/api/financeiro/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const entrada = req.body;
    console.log(`PUT /api/financeiro/${req.params.id} recebido. body:`, entrada);

    // Se tentando mudar status para 'pago', validar se é uma parcela
    if ((entrada.status || '').toLowerCase() === 'pago') {
        // Primeiro, buscar o registro atual para obter informações de parcela
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

            // Verificar se é uma parcela (numero_parcela > 1)
            const numeroParcela = currentRecord.numero_parcela;
            if (numeroParcela && numeroParcela > 1) {
                // É uma parcela, verificar se a parcela anterior foi paga
                const parcelaAnterior = numeroParcela - 1;
                
                // Buscar parcela anterior do mesmo grupo de parcelamento
                const grupoParcelamentoId = currentRecord.grupo_parcelamento_id || currentRecord.grupoParcelamentoId;
                const orcamentoId = currentRecord.orcamento_id || currentRecord.orcamentoId;
                
                // Montar query para encontrar parcela anterior
                let queryParcelaAnterior = 'SELECT id, status FROM transacoes WHERE numero_parcela = ? AND ';
                let paramsParcelaAnterior = [parcelaAnterior];
                
                if (grupoParcelamentoId) {
                    queryParcelaAnterior += 'grupo_parcelamento_id = ?';
                    paramsParcelaAnterior.push(grupoParcelamentoId);
                } else if (orcamentoId) {
                    queryParcelaAnterior += 'orcamento_id = ? AND numero_parcela = ?';
                    paramsParcelaAnterior = [parcelaAnterior, orcamentoId, parcelaAnterior];
                    queryParcelaAnterior = 'SELECT id, status FROM transacoes WHERE numero_parcela = ? AND orcamento_id = ?';
                    paramsParcelaAnterior = [parcelaAnterior, orcamentoId];
                } else {
                    // Se não houver grupo de parcelamento ou orçamento, usar cliente_id
                    queryParcelaAnterior += 'cliente_id = ?';
                    paramsParcelaAnterior.push(currentRecord.cliente_id);
                }

                db.get(queryParcelaAnterior, paramsParcelaAnterior, (parcelErr, parcelaAnteriorRecord) => {
                    if (parcelErr) {
                        res.status(500).json({ error: parcelErr.message });
                        return;
                    }

                    // Se encontrou parcela anterior e ela não está paga, bloquear
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

                    // Parcela anterior está paga ou não existe, prosseguir com atualização
                    proceedWithUpdate();
                });
            } else {
                // Não é uma parcela ou é a primeira parcela, prosseguir
                proceedWithUpdate();
            }

            function proceedWithUpdate() {
                const sql = `UPDATE transacoes SET 
                    status = ?,
                    descricao = ?,
                    observacoes = ?,
                    data_pagamento = ?,
                    fornecedor = ?,
                    grupo_parcelamento_id = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`;

                const params = [
                    entrada.status || 'aberto',
                    entrada.descricao || '',
                    entrada.observacoes || '',
                    entrada.dataPagamento || null,
                    entrada.fornecedor || entrada.fornecedorNome || entrada.fornecedor_nome || null,
                    entrada.grupoParcelamentoId || null,
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
                    res.json({ id: String(id), ...entrada });
                });
            }
        });
    } else {
        // Não é tentativa de marcar como pago, prosseguir normalmente
        const sql = `UPDATE transacoes SET 
            status = ?,
            descricao = ?,
            observacoes = ?,
            data_pagamento = ?,
            fornecedor = ?,
            grupo_parcelamento_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`;

        const params = [
            entrada.status || 'aberto',
            entrada.descricao || '',
            entrada.observacoes || '',
            entrada.dataPagamento || null,
            entrada.fornecedor || entrada.fornecedorNome || entrada.fornecedor_nome || null,
            entrada.grupoParcelamentoId || null,
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
            res.json({ id: String(id), ...entrada });
        });
    }
});

// DELETE financial entry
app.delete('/api/financeiro/:id', (req, res) => {
    const receivedId = req.params.id;
    console.log(`DELETE /api/financeiro/${receivedId} recebido`);
    // Primeiro buscar o registro para retornar seu tipo/conteúdo
    db.get('SELECT * FROM transacoes WHERE id = ?', [receivedId], (getErr, row) => {
        if (getErr) {
            res.status(500).json({ error: getErr.message, requestedId: receivedId });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Registro não encontrado', requestedId: receivedId });
            return;
        }

        // Guardar tipo e dados antes de deletar
        const tipo = row.tipo || null;
        const removedMapped = {
            ...row,
            id: row.id ? String(row.id) : null,
            orcamentoId: row.orcamento_id,
            clienteId: row.cliente_id,
            formaPagamento: row.forma_pagamento,
            dataPagamento: row.data_pagamento,
            grupoParcelamentoId: row.grupo_parcelamento_id
        };

        db.run('DELETE FROM transacoes WHERE id = ?', [receivedId], function(delErr) {
            if (delErr) {
                res.status(500).json({ error: delErr.message, requestedId: receivedId });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ error: 'Registro não encontrado', requestedId: receivedId });
                return;
            }

            res.json({ success: true, deletedId: String(receivedId), tipo, removed: normalizeFinanceiroRow(removedMapped) });
        });
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

// GET financial entries (receber e pagar)
app.get('/api/financeiro', (req, res) => {
    db.all(`SELECT 
        id,
        tipo,
        valor,
        descricao,
        status,
        data,
        vencimento,
        orcamento_id as orcamentoId,
        cliente_id as clienteId,
        observacoes,
        forma_pagamento as formaPagamento,
        data_pagamento as dataPagamento,
        criado_em as criadoEm,
        grupo_parcelamento_id as grupoParcelamentoId
        FROM transacoes 
        WHERE tipo IN ('receber', 'pagar')
        ORDER BY vencimento DESC, id DESC`, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const dados = rows.map(row => normalizeFinanceiroRow({ ...row, id: row.id ? String(row.id) : null }));
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

// Iniciar servidor
const server = app.listen(port, (err) => {
    if (err) {
        console.error('Erro ao iniciar servidor:', err);
        process.exit(1);
    }
    console.log(`Servidor rodando em http://localhost:${port}`);
    console.log(`Banco de dados local: ${dbPath}`);
    console.log('Callback do app.listen executado');
});
