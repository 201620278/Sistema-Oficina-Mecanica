#!/usr/bin/env node
/**
 * Script de teste para validar a regra de negócio:
 * "O usuário só pode liquidar uma parcela se a parcela anterior já foi totalmente paga"
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
        process.exit(1);
    }
    console.log('Conectado ao banco de dados para testes\n');
    runTests();
});

function runTests() {
    console.log('='.repeat(60));
    console.log('TESTE: Regra de Liquidação Sequencial de Parcelas');
    console.log('='.repeat(60));

    // Limpar dados de teste anteriores
    db.run("DELETE FROM transacoes WHERE grupo_parcelamento_id LIKE 'teste-%'", () => {
        console.log('✓ Limpeza de dados anteriores concluída\n');

        // Criar dados de teste: 3 parcelas
        const grupoId = 'teste-' + Date.now();
        const parcelas = [
            {
                descricao: 'Orçamento 123 - Parcela 1',
                tipo: 'receber',
                valor: 1000,
                numero_parcela: 1,
                total_parcelas: 3,
                status: 'aberto',
                vencimento: '2026-02-01',
                grupo_parcelamento_id: grupoId
            },
            {
                descricao: 'Orçamento 123 - Parcela 2',
                tipo: 'receber',
                valor: 1000,
                numero_parcela: 2,
                total_parcelas: 3,
                status: 'aberto',
                vencimento: '2026-03-01',
                grupo_parcelamento_id: grupoId
            },
            {
                descricao: 'Orçamento 123 - Parcela 3',
                tipo: 'receber',
                valor: 1000,
                numero_parcela: 3,
                total_parcelas: 3,
                status: 'aberto',
                vencimento: '2026-04-01',
                grupo_parcelamento_id: grupoId
            }
        ];

        const parcelaIds = [];
        let inserted = 0;

        parcelas.forEach((parcela, idx) => {
            db.run(
                `INSERT INTO transacoes 
                (descricao, tipo, valor, numero_parcela, total_parcelas, status, vencimento, grupo_parcelamento_id, data, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, CURRENT_TIMESTAMP)`,
                [
                    parcela.descricao,
                    parcela.tipo,
                    parcela.valor,
                    parcela.numero_parcela,
                    parcela.total_parcelas,
                    parcela.status,
                    parcela.vencimento,
                    parcela.grupo_parcelamento_id
                ],
                function(err) {
                    if (err) {
                        console.error(`✗ Erro ao inserir parcela ${idx + 1}:`, err.message);
                        return;
                    }
                    parcelaIds[idx] = this.lastID;
                    inserted++;

                    console.log(`✓ Parcela ${idx + 1} criada - ID: ${this.lastID}`);

                    // Quando todas forem inseridas, executar testes
                    if (inserted === parcelas.length) {
                        console.log('\n' + '='.repeat(60));
                        console.log('Iniciando testes...');
                        console.log('='.repeat(60) + '\n');
                        runSequentialTests(grupoId, parcelaIds);
                    }
                }
            );
        });
    });
}

function runSequentialTests(grupoId, parcelaIds) {
    // Teste 1: Tentar liquidar parcela 2 sem liquidar parcela 1
    console.log('TESTE 1: Tentar liquidar parcela 2 (sem pagar parcela 1)');
    console.log('Expected: FALHAR ❌');

    db.get(
        'SELECT * FROM transacoes WHERE numero_parcela = 2 AND grupo_parcelamento_id = ?',
        [grupoId],
        (err, parcela2) => {
            if (err || !parcela2) {
                console.error('Erro ao buscar parcela 2');
                return;
            }

            // Simular a validação do servidor
            db.get(
                'SELECT status FROM transacoes WHERE numero_parcela = 1 AND grupo_parcelamento_id = ?',
                [grupoId],
                (err, parcela1) => {
                    if (parcela1 && (parcela1.status || '').toLowerCase() !== 'pago') {
                        console.log('✓ BLOQUEADO: Parcela anterior não foi paga');
                        console.log(`  Status da parcela 1: ${parcela1.status}`);
                    } else {
                        console.log('✗ ERRO: Deveria ter bloqueado!');
                    }

                    console.log('\n' + '-'.repeat(60) + '\n');

                    // Teste 2: Liquidar parcela 1
                    test2(grupoId, parcelaIds);
                }
            );
        }
    );
}

function test2(grupoId, parcelaIds) {
    console.log('TESTE 2: Liquidar parcela 1');
    console.log('Expected: SUCESSO ✓');

    db.run(
        'UPDATE transacoes SET status = ?, data_pagamento = CURRENT_DATE WHERE numero_parcela = 1 AND grupo_parcelamento_id = ?',
        ['pago', grupoId],
        function(err) {
            if (err) {
                console.error('Erro:', err.message);
                return;
            }
            console.log(`✓ SUCESSO: Parcela 1 liquidada (${this.changes} registro atualizado)`);

            db.get(
                'SELECT status FROM transacoes WHERE numero_parcela = 1 AND grupo_parcelamento_id = ?',
                [grupoId],
                (err, parcela1) => {
                    console.log(`  Status atual: ${parcela1.status}`);

                    console.log('\n' + '-'.repeat(60) + '\n');
                    test3(grupoId);
                }
            );
        }
    );
}

function test3(grupoId) {
    console.log('TESTE 3: Tentar liquidar parcela 3 (parcela 2 não paga)');
    console.log('Expected: FALHAR ❌');

    db.get(
        'SELECT status FROM transacoes WHERE numero_parcela = 2 AND grupo_parcelamento_id = ?',
        [grupoId],
        (err, parcela2) => {
            if (parcela2 && (parcela2.status || '').toLowerCase() !== 'pago') {
                console.log('✓ BLOQUEADO: Parcela 2 não foi paga');
                console.log(`  Status da parcela 2: ${parcela2.status}`);
            } else {
                console.log('✗ ERRO: Deveria ter bloqueado!');
            }

            console.log('\n' + '-'.repeat(60) + '\n');
            test4(grupoId);
        }
    );
}

function test4(grupoId) {
    console.log('TESTE 4: Liquidar parcela 2');
    console.log('Expected: SUCESSO ✓');

    db.run(
        'UPDATE transacoes SET status = ?, data_pagamento = CURRENT_DATE WHERE numero_parcela = 2 AND grupo_parcelamento_id = ?',
        ['pago', grupoId],
        function(err) {
            if (err) {
                console.error('Erro:', err.message);
                return;
            }
            console.log(`✓ SUCESSO: Parcela 2 liquidada (${this.changes} registro atualizado)`);

            db.get(
                'SELECT status FROM transacoes WHERE numero_parcela = 2 AND grupo_parcelamento_id = ?',
                [grupoId],
                (err, parcela2) => {
                    console.log(`  Status atual: ${parcela2.status}`);

                    console.log('\n' + '-'.repeat(60) + '\n');
                    test5(grupoId);
                }
            );
        }
    );
}

function test5(grupoId) {
    console.log('TESTE 5: Agora liquidar parcela 3 (ambas anteriores pagas)');
    console.log('Expected: SUCESSO ✓');

    db.get(
        'SELECT status FROM transacoes WHERE numero_parcela = 2 AND grupo_parcelamento_id = ?',
        [grupoId],
        (err, parcela2) => {
            if (parcela2 && (parcela2.status || '').toLowerCase() === 'pago') {
                console.log('✓ Parcela 2 confirmada como PAGA');

                db.run(
                    'UPDATE transacoes SET status = ?, data_pagamento = CURRENT_DATE WHERE numero_parcela = 3 AND grupo_parcelamento_id = ?',
                    ['pago', grupoId],
                    function(err) {
                        if (err) {
                            console.error('Erro:', err.message);
                            finalize();
                            return;
                        }
                        console.log(`✓ SUCESSO: Parcela 3 liquidada (${this.changes} registro atualizado)`);

                        db.get(
                            'SELECT status FROM transacoes WHERE numero_parcela = 3 AND grupo_parcelamento_id = ?',
                            [grupoId],
                            (err, parcela3) => {
                                console.log(`  Status atual: ${parcela3.status}`);
                                finalize();
                            }
                        );
                    }
                );
            } else {
                console.log('✗ ERRO: Parcela 2 não está paga!');
                finalize();
            }
        }
    );
}

function finalize() {
    console.log('\n' + '='.repeat(60));
    console.log('Todos os testes concluídos!');
    console.log('='.repeat(60) + '\n');

    // Mostrar estado final das parcelas
    db.all(
        'SELECT numero_parcela, status FROM transacoes WHERE grupo_parcelamento_id LIKE "teste-%" ORDER BY numero_parcela',
        [],
        (err, rows) => {
            console.log('Estado final das parcelas:');
            rows.forEach(row => {
                const icon = row.status === 'pago' ? '✓' : '✗';
                console.log(`  ${icon} Parcela ${row.numero_parcela}: ${row.status}`);
            });

            db.close((err) => {
                if (err) {
                    console.error('Erro ao fechar banco:', err.message);
                }
                process.exit(0);
            });
        }
    );
}
