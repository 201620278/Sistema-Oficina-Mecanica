const http = require('http');

const BASE = 'http://localhost:3000';

function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(path, BASE);
            const isHttps = url.protocol === 'https:';
            const payload = data ? JSON.stringify(data) : null;
            const options = {
                method,
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                headers: {}
            };
            if (payload) {
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(payload);
            }

            const req = (isHttps ? require('https') : require('http')).request(options, (res) => {
                let chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let parsed = raw;
                    try { parsed = JSON.parse(raw); } catch (e) { /* keep raw */ }
                    resolve({ status: res.statusCode, body: parsed, headers: res.headers });
                });
            });

            req.on('error', (err) => reject(err));

            if (payload) req.write(payload);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

(async function run() {
    console.log('=== Teste básico do módulo financeiro ===');

    try {
        const hoje = new Date().toISOString().split('T')[0];
        const localId = 'local-test-' + Date.now();
        const item = {
            id: localId,
            tipo: 'receber',
            cliente: 'Teste Automático',
            descricao: 'Lançamento de teste',
            valor: 199.9,
            vencimento: hoje,
            status: 'aberto'
        };

        console.log('POST /api/financeiro -> criar item (tentativa ao servidor local)');
        const post = await request('POST', '/api/financeiro', item);
        console.log('POST status=', post.status);
        console.log('POST body=', post.body);

        const serverId = post.body && post.body.id ? String(post.body.id) : null;

        console.log('\nGET /api/financeiro -> listar');
        const getAll = await request('GET', '/api/financeiro');
        console.log('GET status=', getAll.status);
        if (Array.isArray(getAll.body)) {
            console.log('Total registros retornados:', getAll.body.length);
        } else {
            console.log('GET body:', getAll.body);
        }

        if (serverId) {
            console.log(`\nDELETE /api/financeiro/${serverId} -> remover item criado`);
            const del = await request('DELETE', `/api/financeiro/${serverId}`);
            console.log('DELETE status=', del.status);
            console.log('DELETE body=', del.body);
        } else {
            console.log('\nNenhum id do servidor retornado — se o servidor estiver offline, verifique `financeiro-sync-queue` no localStorage do navegador.');
        }

        // Agora testar cleanup: criar dois registros antigos e executar cleanup via admin
        console.log('\nTestando cleanup (criar registros antigos)...');
        const oldDate = '2020-01-01';
        const itemOld1 = { id: 'old-1-' + Date.now(), tipo: 'receber', cliente: 'Old1', descricao: 'Velho 1', valor: 10, vencimento: oldDate, status: 'aberto' };
        const itemOld2 = { id: 'old-2-' + Date.now(), tipo: 'receber', cliente: 'Old2', descricao: 'Velho 2', valor: 20, vencimento: oldDate, status: 'aberto' };
        const p1 = await request('POST', '/api/financeiro', itemOld1);
        const p2 = await request('POST', '/api/financeiro', itemOld2);
        console.log('POST old1 status=', p1.status, 'body=', p1.body && p1.body.id);
        console.log('POST old2 status=', p2.status, 'body=', p2.body && p2.body.id);

        // Login admin para obter cookie
        console.log('\nLogin admin para executar cleanup...');
        const login = await request('POST', '/api/admin/login', { username: 'Cicero Diego', password: 'Pdb100623@' });
        console.log('Login status=', login.status);
        const setCookie = login.headers && (login.headers['set-cookie'] || login.headers['Set-Cookie']);
        let cookieHeader = null;
        if (setCookie && Array.isArray(setCookie)) {
            // encontrar cookie admin_token
            const adminCookie = setCookie.find(c => c.includes('admin_token='));
            if (adminCookie) cookieHeader = adminCookie.split(';')[0];
        } else if (typeof setCookie === 'string') {
            cookieHeader = setCookie.split(';')[0];
        }

        if (!cookieHeader) {
            console.warn('Não foi possível obter cookie de login admin. Cleanup pode falhar.');
        }

        // Executar cleanup para data ampla (remover até 2030) com confirmação
        console.log('\nExecutando /api/financeiro/cleanup ...');
        const cleanupBody = { beforeDate: '2030-01-01', confirm: true };
        const cleanupOpts = {};
        // fazer request manual para enviar cookie header usando http
        const cleanupResp = await new Promise((resolve, reject) => {
            try {
                const url = new URL('/api/financeiro/cleanup', BASE);
                const payload = JSON.stringify(cleanupBody);
                const options = {
                    method: 'POST',
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };
                if (cookieHeader) options.headers['Cookie'] = cookieHeader;
                const req = require('http').request(options, (res) => {
                    let ch = [];
                    res.on('data', c => ch.push(c));
                    res.on('end', () => {
                        const raw = Buffer.concat(ch).toString('utf8');
                        let parsed = raw;
                        try { parsed = JSON.parse(raw); } catch (e) {}
                        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
                    });
                });
                req.on('error', (e) => reject(e));
                req.write(payload);
                req.end();
            } catch (e) { reject(e); }
        });
        console.log('Cleanup status=', cleanupResp.status);
        console.log('Cleanup body=', cleanupResp.body);

        // Verificar se os ids removidos não aparecem mais
        const after = await request('GET', '/api/financeiro');
        console.log('GET after cleanup status=', after.status);
        if (Array.isArray(after.body)) {
            console.log('Total registros após cleanup:', after.body.length);
        }

        console.log('\nTeste concluído.');
    } catch (err) {
        console.error('Erro no teste:', err);
        process.exit(1);
    }
})();
