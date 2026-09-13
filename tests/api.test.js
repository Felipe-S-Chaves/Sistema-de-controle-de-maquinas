'use strict';

/**
 * Testes de API de ponta a ponta contra um MySQL real (banco de teste).
 * Cobre os itens exigidos na secao 66 da especificacao.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let admin;      // cliente autenticado
let anon;       // cliente sem token
let ownerId;
let machineId;

test.before(async () => {
  await h.resetDatabase();
  await h.startServer();
  h.cleanUploads();
  anon = h.client();
  admin = h.client(await h.login());
});

test.after(async () => {
  h.cleanUploads();
  await h.stopServer();
});

// ====================================================================
// AUTENTICACAO
// ====================================================================
test('auth: login com credenciais corretas devolve token e usuario', async () => {
  const r = await anon.post('/api/auth/login', { email: 'admin@sistema.local', password: 'Admin@123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.ok(r.body.data.token);
  assert.equal(r.body.data.user.email, 'admin@sistema.local');
  assert.equal(r.body.data.user.password_hash, undefined, 'hash nunca vai para o cliente');
});

test('auth: senha errada devolve 401 sem revelar se o e-mail existe', async () => {
  const r = await anon.post('/api/auth/login', { email: 'admin@sistema.local', password: 'errada' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'INVALID_CREDENTIALS');
  assert.equal(r.body.message, 'E-mail ou senha invalidos.');
});

test('auth: e-mail inexistente devolve a MESMA mensagem generica', async () => {
  const r = await anon.post('/api/auth/login', { email: 'ninguem@exemplo.com', password: 'Admin@123' });
  assert.equal(r.status, 401);
  assert.equal(r.body.message, 'E-mail ou senha invalidos.');
});

test('auth: acesso sem token e bloqueado', async () => {
  const r = await anon.get('/api/dashboard');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'NO_TOKEN');
});

test('auth: token invalido e bloqueado', async () => {
  const r = await h.client('token.completamente.invalido').get('/api/dashboard');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'INVALID_TOKEN');
});

test('auth: token expirado e bloqueado', async () => {
  const jwt = require('jsonwebtoken');
  const config = require('../backend/config/env');
  const expired = jwt.sign({ sub: 1, role: 'admin' }, config.jwt.secret, { expiresIn: '-1h' });
  const r = await h.client(expired).get('/api/dashboard');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'TOKEN_EXPIRED');
});

test('auth: token assinado com outro segredo e rejeitado', async () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ sub: 1, role: 'admin' }, 'segredo-do-atacante', { expiresIn: '1h' });
  const r = await h.client(forged).get('/api/dashboard');
  assert.equal(r.status, 401);
});

// ====================================================================
// PROPRIETARIOS
// ====================================================================
test('owners: cria proprietario com dados validos', async () => {
  const r = await admin.post('/api/owners', {
    name: 'João da Silva', document: '111.444.777-35',
    phone: '(11) 98888-7777', whatsapp: '11988887777',
    email: 'JOAO@Exemplo.com', address: 'Rua das Flores, 100',
    city: 'São Paulo', state: 'sp', zip_code: '01310100'
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.document, '11144477735', 'documento normalizado');
  assert.equal(r.body.data.document_type, 'cpf');
  assert.equal(r.body.data.email, 'joao@exemplo.com', 'e-mail normalizado');
  assert.equal(r.body.data.state, 'SP', 'UF em maiusculas');
  assert.equal(r.body.data.zip_code, '01310-100');
  ownerId = r.body.data.id;
});

test('owners: CPF invalido e recusado', async () => {
  const r = await admin.post('/api/owners', { name: 'Teste', document: '11111111111' });
  assert.equal(r.status, 422);
  assert.equal(r.body.details.document, 'CPF invalido.');
});

test('owners: CPF duplicado e recusado com 409', async () => {
  const r = await admin.post('/api/owners', { name: 'Outro', document: '11144477735' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'DUPLICATE_DOCUMENT');
});

test('owners: nome obrigatorio', async () => {
  const r = await admin.post('/api/owners', { document: '52998224725' });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.name);
});

test('owners: edicao atualiza os dados', async () => {
  const r = await admin.put(`/api/owners/${ownerId}`, {
    name: 'João da Silva Junior', document: '11144477735', phone: '11999998888'
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.name, 'João da Silva Junior');

  await admin.put(`/api/owners/${ownerId}`, { name: 'João da Silva', document: '11144477735' });
});

test('owners: pesquisa parcial e insensivel a maiusculas/acentos do termo', async () => {
  await admin.post('/api/owners', { name: 'João Carlos', document: '52998224725' });
  await admin.post('/api/owners', { name: 'Maria Oliveira' });

  const r = await admin.get('/api/owners?search=jo');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length >= 2, 'encontra Joao da Silva e Joao Carlos');
  assert.ok(r.body.data.every((o) => /jo/i.test(o.name)));

  const upper = await admin.get('/api/owners?search=JOAO');
  assert.equal(upper.status, 200);
});

test('owners: busca por documento aceita mascara', async () => {
  const r = await admin.get('/api/owners?search=111.444.777-35');
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].document, '11144477735');
});

test('owners: ativacao e desativacao', async () => {
  const off = await admin.patch(`/api/owners/${ownerId}/status`, { status: 'inactive' });
  assert.equal(off.body.data.status, 'inactive');
  const on = await admin.patch(`/api/owners/${ownerId}/status`, { status: 'active' });
  assert.equal(on.body.data.status, 'active');
});

test('owners: proprietario inexistente devolve 404', async () => {
  const r = await admin.get('/api/owners/999999');
  assert.equal(r.status, 404);
});

test('owners: paginacao devolve metadados corretos', async () => {
  const r = await admin.get('/api/owners?page=1&pageSize=2');
  assert.equal(r.body.data.length, 2);
  assert.equal(r.body.pagination.pageSize, 2);
  assert.ok(r.body.pagination.total >= 3);
  assert.ok(r.body.pagination.totalPages >= 2);
});

// ====================================================================
// MAQUINAS
// ====================================================================
test('machines: cria maquina vinculada ao proprietario', async () => {
  const r = await admin.post('/api/machines', {
    number: '001', name: 'Máquina Principal', owner_id: ownerId, installation_date: '2026-01-15'
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.number, '001');
  assert.equal(r.body.data.owner_id, ownerId);
  assert.equal(r.body.data.status, 'active', 'status padrao e Ativa');
  machineId = r.body.data.id;
});

test('machines: numero unico e obrigatorio', async () => {
  const dup = await admin.post('/api/machines', { number: '001', name: 'Outra', owner_id: ownerId });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'DUPLICATE_MACHINE_NUMBER');
});

test('machines: so existem os status active e maintenance', async () => {
  const r = await admin.post('/api/machines', {
    number: '900', name: 'Teste Status', owner_id: ownerId, status: 'parada'
  });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.status);
});

test('machines: alterna entre Ativa e Manutencao', async () => {
  const m = await admin.patch(`/api/machines/${machineId}/status`, { status: 'maintenance' });
  assert.equal(m.body.data.status, 'maintenance');
  const a = await admin.patch(`/api/machines/${machineId}/status`, { status: 'active' });
  assert.equal(a.body.data.status, 'active');
});

test('machines: proprietario inexistente e recusado', async () => {
  const r = await admin.post('/api/machines', { number: '901', name: 'Orfa', owner_id: 999999 });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.owner_id);
});

test('machines: listagem por proprietario devolve so as maquinas dele', async () => {
  await admin.post('/api/machines', { number: '002', name: 'Máquina Salão', owner_id: ownerId });

  const outro = await admin.post('/api/owners', { name: 'Bar do Ze LTDA', document: '11222333000181' });
  await admin.post('/api/machines', { number: '010', name: 'Máquina do Bar', owner_id: outro.body.data.id });

  const r = await admin.get(`/api/owners/${ownerId}/machines`);
  assert.equal(r.body.data.length, 2);
  assert.ok(r.body.data.every((m) => ['001', '002'].includes(m.number)));
});

// ====================================================================
// COLETAS
// ====================================================================
test('collections: coleta sem foto e recusada', async () => {
  const form = new FormData();
  form.append('machine_id', String(machineId));
  form.append('current_entry_value', '6000');
  form.append('current_exit_value', '4200');

  const r = await admin.upload('/api/collections', form);
  assert.equal(r.status, 422);
  assert.equal(r.body.details.images, 'Pelo menos uma foto e obrigatoria.');
});

test('collections: arquivo que so finge ser imagem e recusado', async () => {
  const r = await admin.upload('/api/collections', h.fakeImageForm({
    machine_id: machineId, current_entry_value: '6000', current_exit_value: '4200'
  }));
  assert.equal(r.status, 422);
  assert.match(r.body.message, /nao e uma imagem valida/);
});

test('collections: PRIMEIRA coleta aceita a leitura anterior informada pelo operador', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId,
    previous_entry_value: '5100', previous_exit_value: '3600',
    current_entry_value: '6000', current_exit_value: '4200',
    observation: 'Primeira leitura da maquina.'
  }, 2));

  assert.equal(r.status, 201);
  const c = r.body.data;
  assert.equal(c.is_first_collection, 1);
  assert.equal(c.previous_entry_value, '5100.00');
  assert.equal(c.calculated_entry_value, '900.00');   // 6000 - 5100
  assert.equal(c.calculated_exit_value, '600.00');    // 4200 - 3600
  assert.equal(c.calculated_total_value, '300.00');   // 900 - 600
  assert.equal(c.images.length, 2, 'aceita multiplas imagens');
  assert.equal(c.status, 'confirmed');
});

test('collections: leitura anterior vem do banco, nunca do frontend', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId,
    previous_entry_value: '0',          // tentativa de forjar
    previous_exit_value: '0',           // tentativa de forjar
    calculated_total_value: '999999',   // tentativa de forjar
    calculated_entry_value: '888888',
    current_entry_value: '7200', current_exit_value: '5100'
  }));

  assert.equal(r.status, 201);
  const c = r.body.data;
  assert.equal(c.previous_entry_value, '6000.00', 'ignora o previous enviado');
  assert.equal(c.previous_exit_value, '4200.00');
  assert.equal(c.calculated_entry_value, '1200.00');
  assert.equal(c.calculated_exit_value, '900.00');
  assert.equal(c.calculated_total_value, '300.00', 'ignora o total forjado');
});

test('collections: terceira coleta segue o encadeamento (exemplo da especificacao)', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '9.500,00', current_exit_value: '5800'
  }));

  const c = r.body.data;
  assert.equal(c.previous_entry_value, '7200.00');
  assert.equal(c.previous_exit_value, '5100.00');
  assert.equal(c.calculated_entry_value, '2300.00');
  assert.equal(c.calculated_exit_value, '700.00');
  assert.equal(c.calculated_total_value, '1600.00');
});

test('collections: historico anterior permanece intacto', async () => {
  const r = await admin.get(`/api/machines/${machineId}/collections?orderDir=ASC`);
  const rows = r.body.data;
  assert.equal(rows.length, 3);

  assert.deepEqual(
    rows.map((c) => [c.previous_entry_value, c.current_entry_value, c.calculated_total_value]),
    [['5100.00', '6000.00', '300.00'],
      ['6000.00', '7200.00', '300.00'],
      ['7200.00', '9500.00', '1600.00']]
  );
});

test('collections: ultima leitura reflete a coleta mais recente', async () => {
  const r = await admin.get(`/api/machines/${machineId}/last-reading`);
  assert.equal(r.body.data.is_first_collection, false);
  assert.equal(r.body.data.last_collection.entry_value, '9500.00');
  assert.equal(r.body.data.last_collection.exit_value, '5800.00');
});

test('collections: leitura menor que a anterior bloqueia com 409', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '9000', current_exit_value: '5900'
  }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'READING_LOWER_THAN_PREVIOUS');
  assert.match(r.body.details.current_entry_value, /menor que a leitura anterior/);
  assert.equal(r.body.details.previous_entry_value, '9500.00');
});

test('collections: excecao sem motivo suficiente e recusada', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '9000', current_exit_value: '5900',
    confirm_exception: 'true', exception_reason: 'erro'
  }));
  assert.equal(r.status, 422);
  assert.ok(r.body.details.exception_reason);
});

test('collections: excecao com motivo e aceita e marcada', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '9000', current_exit_value: '5900',
    confirm_exception: 'true',
    exception_reason: 'Contador reiniciado pelo tecnico durante a manutencao.'
  }));
  assert.equal(r.status, 201);
  assert.equal(r.body.data.is_exception, 1);
  assert.equal(r.body.data.calculated_entry_value, '-500.00');
  assert.equal(r.body.data.calculated_exit_value, '100.00');
  assert.equal(r.body.data.calculated_total_value, '-600.00');
});

test('collections: valores negativos sao recusados', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '-100', current_exit_value: '10'
  }));
  assert.equal(r.status, 422);
  assert.ok(r.body.details.current_entry_value);
});

test('collections: maquina inexistente devolve 404', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: 999999, current_entry_value: '100', current_exit_value: '10'
  }));
  assert.equal(r.status, 404);
});

// ====================================================================
// CANCELAMENTO
// ====================================================================
test('collections: cancelamento exige motivo', async () => {
  const list = await admin.get(`/api/machines/${machineId}/collections`);
  const latest = list.body.data[0];

  const r = await admin.post(`/api/collections/${latest.id}/cancel`, { reason: 'erro' });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.reason);
});

test('collections: nao cancela coleta com outra posterior confirmada', async () => {
  const list = await admin.get(`/api/machines/${machineId}/collections?orderDir=ASC`);
  const first = list.body.data[0];

  const r = await admin.post(`/api/collections/${first.id}/cancel`, {
    reason: 'Tentativa de cancelar uma coleta antiga do encadeamento.'
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'HAS_LATER_COLLECTION');
});

test('collections: cancelamento da mais recente funciona e preserva o registro', async () => {
  const list = await admin.get(`/api/machines/${machineId}/collections`);
  const latest = list.body.data[0];

  const r = await admin.post(`/api/collections/${latest.id}/cancel`, {
    reason: 'Leitura registrada por engano durante teste do equipamento.'
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'cancelled');
  assert.ok(r.body.data.cancelled_at);

  const detail = await admin.get(`/api/collections/${latest.id}`);
  assert.equal(detail.status, 200, 'coleta cancelada continua acessivel');
  assert.equal(detail.body.data.status, 'cancelled');
});

test('collections: coleta cancelada nao pode ser cancelada de novo', async () => {
  const list = await admin.get(`/api/machines/${machineId}/collections?status=cancelled`);
  const cancelled = list.body.data[0];
  const r = await admin.post(`/api/collections/${cancelled.id}/cancel`, {
    reason: 'Segunda tentativa de cancelamento do mesmo registro.'
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ALREADY_CANCELLED');
});

test('collections: coleta cancelada continua no historico', async () => {
  const r = await admin.get(`/api/machines/${machineId}/collections`);
  assert.equal(r.body.data.length, 4, 'as 4 coletas continuam listadas');
  assert.equal(r.body.data.filter((c) => c.status === 'cancelled').length, 1);
});

test('collections: proxima leitura ignora a coleta cancelada', async () => {
  const r = await admin.get(`/api/machines/${machineId}/last-reading`);
  assert.equal(r.body.data.last_collection.entry_value, '9500.00',
    'volta para a ultima coleta confirmada, nao a cancelada');
});

// ====================================================================
// TOTAIS E RELATORIOS
// ====================================================================
test('reports: totais somam apenas coletas confirmadas', async () => {
  const r = await admin.get(`/api/reports/period?machine_id=${machineId}&period=all`);
  const t = r.body.data.totals;

  // Confirmadas: 900+1200+2300 = 4400 entrada ; 600+900+700 = 2200 saida
  assert.equal(t.collections_count, 3);
  assert.equal(t.total_entry, '4400.00');
  assert.equal(t.total_exit, '2200.00');
  assert.equal(t.total_value, '2200.00');
  assert.equal(Number(t.total_entry) - Number(t.total_exit), Number(t.total_value),
    'total apurado = entrada apurada - saida apurada');
});

test('reports: relatorio por proprietario consolida corretamente', async () => {
  const r = await admin.get(`/api/reports/owners?owner_id=${ownerId}&period=all`);
  assert.equal(r.body.data.rows.length, 1);
  assert.equal(r.body.data.rows[0].collections_count, 3);
  assert.equal(r.body.data.totals.total_value, '2200.00');
});

test('reports: relatorio por maquina lista todas, inclusive sem coleta', async () => {
  const r = await admin.get(`/api/reports/machines?owner_id=${ownerId}&period=all`);
  assert.equal(r.body.data.rows.length, 2, '001 e 002');
  const sem = r.body.data.rows.find((m) => m.number === '002');
  assert.equal(Number(sem.collections_count), 0);
  assert.equal(Number(sem.total_value), 0);
});

test('reports: filtro de periodo restringe os resultados', async () => {
  const futuro = await admin.get('/api/reports/period?period=custom&start_date=2020-01-01&end_date=2020-12-31');
  assert.equal(futuro.body.data.totals.collections_count, 0);
  assert.equal(futuro.body.data.totals.total_value, '0.00');
});

test('reports: periodo invalido devolve 422', async () => {
  const r = await admin.get('/api/reports/period?period=custom&start_date=2026-12-31&end_date=2026-01-01');
  assert.equal(r.status, 422);
});

test('reports: PDF e gerado com conteudo valido', async () => {
  const r = await admin.raw(`/api/reports/pdf?type=period&machine_id=${machineId}&period=all`);
  assert.equal(r.status, 200);
  assert.equal(r.response.headers.get('content-type'), 'application/pdf');
  assert.equal(r.buffer.slice(0, 5).toString(), '%PDF-', 'assinatura de PDF');
  assert.ok(r.buffer.length > 1000, 'PDF com conteudo');
});

test('reports: PDF exige autenticacao', async () => {
  const r = await anon.get('/api/reports/pdf?type=period&period=all');
  assert.equal(r.status, 401);
});

// ====================================================================
// DASHBOARD E BUSCA
// ====================================================================
test('dashboard: metricas refletem o banco', async () => {
  const r = await admin.get('/api/dashboard?period=all');
  const m = r.body.data.metrics;
  assert.ok(m.owners_total >= 4);
  assert.ok(m.machines_total >= 3);
  assert.equal(m.machines_active + m.machines_maintenance, m.machines_total);
  assert.equal(m.collections_cancelled, 1);
  assert.ok(r.body.data.latest_collections.length > 0);
});

test('dashboard: nao expoe metricas proibidas pela especificacao', async () => {
  const r = await admin.get('/api/dashboard?period=all');
  const keys = Object.keys(r.body.data.metrics);
  assert.equal(keys.some((k) => /establishment|estabelecimento/i.test(k)), false);
});

test('search: busca global identifica o tipo de cada resultado', async () => {
  const porNumero = await admin.get('/api/search?q=001');
  assert.equal(porNumero.body.data.machines.length, 1);
  assert.equal(porNumero.body.data.machines[0].type, 'machine');

  const porNome = await admin.get('/api/search?q=Jo');
  assert.ok(porNome.body.data.owners.length >= 2);
  assert.equal(porNome.body.data.owners[0].type, 'owner');

  const porMaquina = await admin.get('/api/search?q=Salão');
  assert.equal(porMaquina.body.data.machines.length, 1);
});

// ====================================================================
// AUDITORIA
// ====================================================================
test('audit: operacoes importantes ficam registradas', async () => {
  const r = await admin.get('/api/audit-logs?pageSize=100&period=all');
  const actions = r.body.data.map((a) => `${a.entity}/${a.action}`);

  assert.ok(actions.includes('collection/create'), 'criacao de coleta');
  assert.ok(actions.includes('collection/create_exception'), 'excecao de leitura');
  assert.ok(actions.includes('collection/cancel'), 'cancelamento');
  assert.ok(actions.includes('owner/create'), 'criacao de proprietario');
  assert.ok(actions.includes('machine/create'), 'criacao de maquina');
  assert.ok(actions.includes('auth/login'), 'login');
  assert.ok(actions.includes('auth/login_failed'), 'tentativa de login');
});

test('audit: cancelamento guarda motivo, usuario e valores', async () => {
  const r = await admin.get('/api/audit-logs?entity=collection&pageSize=50&period=all');
  const cancel = r.body.data.find((a) => a.action === 'cancel');

  assert.ok(cancel.reason.length >= 10);
  assert.equal(cancel.user_name, 'Administrador');
  assert.equal(cancel.old_values.status, 'confirmed');
  assert.equal(cancel.new_values.status, 'cancelled');
});

test('audit: exige papel de administrador', async () => {
  const r = await anon.get('/api/audit-logs');
  assert.equal(r.status, 401);
});

// ====================================================================
// SEGURANCA
// ====================================================================
test('seguranca: SQL injection na busca nao quebra nem vaza dados', async () => {
  const todos = await admin.get('/api/owners?pageSize=100');
  const totalReal = todos.body.pagination.total;

  // Se a query nao fosse parametrizada, este payload devolveria TODAS as linhas.
  const injecao = await admin.get(`/api/owners?search=${encodeURIComponent("' OR 'a'='a")}`);
  assert.equal(injecao.status, 200);
  assert.equal(injecao.body.data.length, 0, 'a string e tratada como texto, nao como SQL');
  assert.notEqual(injecao.body.pagination.total, totalReal, 'nao vazou a tabela inteira');

  const drop = await admin.get(`/api/owners?search=${encodeURIComponent("'; DROP TABLE owners; --")}`);
  assert.equal(drop.status, 200);
  assert.equal(drop.body.data.length, 0);

  const union = await admin.get(`/api/owners?search=${encodeURIComponent("x' UNION SELECT password_hash FROM users --")}`);
  assert.equal(union.status, 200);
  assert.equal(union.body.data.length, 0);

  const ainda = await admin.get('/api/owners?pageSize=100');
  assert.equal(ainda.body.pagination.total, totalReal, 'tabela intacta apos os payloads');
});

test('seguranca: HTML enviado e armazenado como texto puro', async () => {
  const payload = '<script>alert(1)</script>';
  const r = await admin.post('/api/owners', { name: `Teste ${payload}` });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.name, `Teste ${payload}`, 'guardado literal; o frontend escapa na exibicao');
});

test('seguranca: rota inexistente devolve erro padronizado sem stack trace', async () => {
  // Sem token, rotas da API respondem 401 antes de revelar se a rota existe.
  const semToken = await anon.get('/api/rota-que-nao-existe');
  assert.equal(semToken.status, 401);
  assert.equal(semToken.body.stack, undefined);

  const comToken = await admin.get('/api/rota-que-nao-existe');
  assert.equal(comToken.status, 404);
  assert.equal(comToken.body.error, 'ROUTE_NOT_FOUND');
  assert.equal(comToken.body.success, false);
  assert.equal(comToken.body.stack, undefined);
  assert.equal(comToken.body.debug, undefined);
});

test('seguranca: imagem so e servida com autenticacao', async () => {
  const list = await admin.get(`/api/machines/${machineId}/collections`);
  const withImages = list.body.data.find((c) => c.images_count > 0);
  const detail = await admin.get(`/api/collections/${withImages.id}`);
  const imageId = detail.body.data.images[0].id;

  const semToken = await anon.get(`/api/collections/images/${imageId}`);
  assert.equal(semToken.status, 401);

  const comToken = await admin.raw(`/api/collections/images/${imageId}`);
  assert.equal(comToken.status, 200);
  assert.equal(comToken.buffer.slice(1, 4).toString(), 'PNG');
});

test('seguranca: cabecalhos de protecao presentes', async () => {
  const r = await anon.raw('/api/health');
  assert.equal(r.status, 200);
  const headers = r.response.headers;
  assert.ok(headers.get('content-security-policy'), 'CSP definida');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-powered-by'), null, 'nao revela o servidor');
  assert.ok(headers.get('x-frame-options') || headers.get('content-security-policy').includes('frame-ancestors'));
});

// ====================================================================
// CONSISTENCIA DOS DADOS
// ====================================================================
test('consistencia: todos os calculos gravados batem com a formula', async () => {
  const db = require('../backend/config/database');
  const rows = await db.query(`
    SELECT id, previous_entry_value, current_entry_value, calculated_entry_value,
           previous_exit_value, current_exit_value, calculated_exit_value, calculated_total_value
      FROM collections`);

  assert.ok(rows.length > 0);
  for (const c of rows) {
    const entry = Math.round((Number(c.current_entry_value) - Number(c.previous_entry_value)) * 100);
    const exit = Math.round((Number(c.current_exit_value) - Number(c.previous_exit_value)) * 100);

    assert.equal(Math.round(Number(c.calculated_entry_value) * 100), entry, `coleta ${c.id}: entrada apurada`);
    assert.equal(Math.round(Number(c.calculated_exit_value) * 100), exit, `coleta ${c.id}: saida apurada`);
    assert.equal(Math.round(Number(c.calculated_total_value) * 100), entry - exit, `coleta ${c.id}: valor apurado`);
  }
});

test('consistencia: nenhuma coleta foi apagada fisicamente', async () => {
  const db = require('../backend/config/database');
  const row = await db.queryOne('SELECT COUNT(*) AS total FROM collections');
  assert.equal(Number(row.total), 4, 'as 4 coletas continuam no banco');
});

test('consistencia: toda coleta possui ao menos uma imagem', async () => {
  const db = require('../backend/config/database');
  const orfas = await db.query(`
    SELECT c.id FROM collections c
     WHERE NOT EXISTS (SELECT 1 FROM collection_images ci WHERE ci.collection_id = c.id)`);
  assert.equal(orfas.length, 0);
});
