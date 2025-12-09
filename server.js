const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const port = 3000;

// Middlewares
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Configuração do banco de dados SQLite local
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite local em:', dbPath);
        inicializarBanco();
    }
});

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
            'ALTER TABLE transacoes ADD COLUMN criado_em TEXT'
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

// Rotas para servir arquivos estáticos
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET endpoints
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
        const transacoes = rows.map(row => ({
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
        }));
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

// POST endpoints
app.post('/api/clientes', (req, res) => {
    const cliente = req.body;
    const endereco = JSON.stringify(cliente.endereco || {});
    const veiculos = JSON.stringify(cliente.veiculos || []);
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
                            veiculos: cliente.veiculos || []
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
                    veiculos: cliente.veiculos || []
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
    const criadoEm = transacao.criadoEm ?? transacao.criado_em ?? new Date().toISOString();

    // Função que executa a inserção no banco
    function doInsert() {
        const baseSql = `(
            orcamento_id,
            cliente_id,
            categoria_id,
            descricao,
            tipo,
            valor,
            data,
            status,
            observacoes,
            parcela_de,
            numero_parcela,
            total_parcelas,
            is_duplicata,
            numero_duplicata,
            forma_pagamento,
            parcelado,
            num_parcelas,
            confirmado_em,
            criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        let sql;
        if (possuiIdCustomizado) {
            sql = `INSERT INTO transacoes (id, ${baseSql.slice(1)}`.replace('VALUES (', 'VALUES (?, ');
        } else {
            sql = `INSERT INTO transacoes ${baseSql}`;
        }

        const params = [
            ...(possuiIdCustomizado ? [idCustomizado] : []),
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
            numParcelas,
            confirmadoEm,
            criadoEm
        ];

        // Log para facilitar depuração em caso de mismatch
        console.log('SQL Inserção transacao:', sql);
        console.log('Params (count):', params.length, params);

        db.run(sql, params, function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const novoId = possuiIdCustomizado ? idCustomizado : this.lastID;
            db.get('SELECT * FROM transacoes WHERE id = ?', [novoId], (err2, row) => {
                if (err2 || !row) {
                    res.json({
                        id: novoId,
                        orcamentoId: orcamentoId || null,
                        clienteId: clienteId || null,
                        categoriaId: categoriaId || null,
                        descricao,
                        tipo: transacao.tipo,
                        valor: transacao.valor,
                        data: transacao.data,
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
        });
    }

    // Se for passado um orcamentoId, verificar se já existe transação para ele e bloquear duplicata
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
            // não existe ainda - prosseguir com inserção
            doInsert();
        });
    } else {
        doInsert();
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
    const veiculos = JSON.stringify(cliente.veiculos || []);
    
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
            res.json({ id, ...cliente });
        }
    );
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

// Iniciar servidor
app.listen(port, 'localhost', () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
    console.log(`Banco de dados local: ${dbPath}`);
});
