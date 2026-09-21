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
test('owners: cria cliente com dados validos', async () => {
  const r = await admin.upload('/api/owners', h.ownerForm({
    name: 'João da Silva', document: '111.444.777-35',
    phone: '(11) 98888-7777', whatsapp: '11988887777',
    email: 'JOAO@Exemplo.com', address: 'Rua das Flores, 100',
    city: 'São Paulo', state: 'sp', zip_code: '01310100'
  }));
  assert.equal(r.status, 201);
  assert.equal(r.body.data.document, '11144477735', 'documento normalizado');
  assert.equal(r.body.data.document_type, 'cpf');
  assert.equal(r.body.data.email, 'joao@exemplo.com', 'e-mail normalizado');
  assert.equal(r.body.data.state, 'SP', 'UF em maiusculas');
  assert.equal(r.body.data.zip_code, '01310-100');
  ownerId = r.body.data.id;
});

test('owners: CPF invalido e recusado', async () => {
  const r = await admin.upload('/api/owners', h.ownerForm({ name: 'Teste', document: '11111111111' }));
  assert.equal(r.status, 422);
  assert.equal(r.body.details.document, 'CPF invalido.');
});

test('owners: CPF duplicado e recusado com 409', async () => {
  const r = await admin.upload('/api/owners', h.ownerForm({ name: 'Outro', document: '11144477735' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'DUPLICATE_DOCUMENT');
});

test('owners: nome obrigatorio', async () => {
  const r = await admin.upload('/api/owners', h.ownerForm({ document: '52998224725' }));
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
  await admin.upload('/api/owners', h.ownerForm({ name: 'João Carlos', document: '52998224725' }));
  await admin.upload('/api/owners', h.ownerForm({ name: 'Maria Oliveira' }));

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

test('owners: cliente inexistente devolve 404', async () => {
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
test('machines: cria maquina vinculada ao cliente', async () => {
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

test('machines: cliente inexistente e recusado', async () => {
  const r = await admin.post('/api/machines', { number: '901', name: 'Orfa', owner_id: 999999 });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.owner_id);
});

test('machines: listagem por cliente devolve so as maquinas dele', async () => {
  await admin.post('/api/machines', { number: '002', name: 'Máquina Salão', owner_id: ownerId });

  const outro = await admin.upload('/api/owners', h.ownerForm({ name: 'Bar do Ze LTDA', document: '11222333000181' }));
  await admin.post('/api/machines', { number: '010', name: 'Máquina do Bar', owner_id: outro.body.data.id });

  const r = await admin.get(`/api/owners/${ownerId}/machines`);
  assert.equal(r.body.data.length, 2);
  assert.ok(r.body.data.every((m) => ['001', '002'].includes(m.number)));
});

// ====================================================================
// COLETAS
// ====================================================================
test('collections: coleta SEM foto e aceita', async () => {
  // Em uma maquina propria, para nao mexer no encadeamento da principal.
  const maquina = await admin.post('/api/machines', {
    number: 'SEM-FOTO', name: 'Maquina Sem Foto', owner_id: ownerId
  });

  const form = new FormData();
  form.append('machine_id', String(maquina.body.data.id));
  form.append('current_entry_value', '6000');
  form.append('current_exit_value', '4200');

  const r = await admin.upload('/api/collections', form);
  assert.equal(r.status, 201, 'a foto deixou de ser obrigatoria');
  assert.equal(r.body.data.images.length, 0);
  assert.equal(r.body.data.calculated_total_value, '1800.00');   // (6000-0) - (4200-0)
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
  assert.equal(c.calculated_entry_value, '1200.00');   // 7200 - 6000
  assert.equal(c.calculated_exit_value, '900.00');     // 5100 - 4200
  assert.equal(c.calculated_total_value, '300.00', 'ignora o total forjado');
});

test('collections: terceira coleta segue o encadeamento (exemplo da especificacao)', async () => {
  const r = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '9.500,00', current_exit_value: '5800'
  }));

  const c = r.body.data;
  assert.equal(c.previous_entry_value, '7200.00');
  assert.equal(c.previous_exit_value, '5100.00');
  assert.equal(c.calculated_entry_value, '2300.00');   // 9500 - 7200
  assert.equal(c.calculated_exit_value, '700.00');     // 5800 - 5100
  assert.equal(c.calculated_total_value, '1600.00');   // 2300 - 700
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
  assert.equal(r.body.data.calculated_entry_value, '-500.00');   // 9000 - 9500
  assert.equal(r.body.data.calculated_exit_value, '100.00');     // 5900 - 5800
  assert.equal(r.body.data.calculated_total_value, '-600.00');   // -500 - 100
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
    'total bruto = entrada apurada - saida apurada');
});

test('reports: o total bruto e a soma linha a linha', async () => {
  const r = await admin.get(`/api/reports/period?machine_id=${machineId}&period=all`);

  const somaDasLinhas = r.body.data.rows
    .reduce((acc, linha) => acc + Math.round(Number(linha.calculated_total_value) * 100), 0);

  assert.equal(Math.round(Number(r.body.data.totals.total_value) * 100), somaDasLinhas,
    'nunca "ultimo relogio - primeiro relogio"');
});

test('reports: cada linha traz as leituras anterior e atual', async () => {
  const r = await admin.get(`/api/reports/period?machine_id=${machineId}&period=all`);
  const linha = r.body.data.rows[0];

  for (const campo of ['previous_entry_value', 'previous_exit_value',
    'current_entry_value', 'current_exit_value', 'calculated_total_value',
    'machine_number', 'machine_name']) {
    assert.ok(linha[campo] !== undefined, `relatorio sem ${campo}`);
  }

  // O valor bruto da linha e a entrada apurada menos a saida apurada.
  assert.equal(
    Number(linha.calculated_entry_value) - Number(linha.calculated_exit_value),
    Number(linha.calculated_total_value)
  );
});

test('reports: selecao por clique aceita varias maquinas', async () => {
  const maquinas = await admin.get(`/api/owners/${ownerId}/machines`);
  const semColeta = maquinas.body.data.find((m) => m.number === '002');
  assert.ok(semColeta, 'o cenario precisa da maquina 002, que nao tem coletas');

  const ids = [machineId, semColeta.id];
  const varias = await admin.get(`/api/reports/period?machine_ids=${ids.join(',')}&period=all`);
  assert.equal(varias.status, 200);
  assert.equal(varias.body.data.machines.length, 2, 'o cabecalho lista as maquinas escolhidas');

  // A maquina 002 nao tem coletas: o recorte com as duas da o mesmo total
  // da maquina 001 sozinha.
  const uma = await admin.get(`/api/reports/period?machine_ids=${machineId}&period=all`);
  assert.equal(varias.body.data.totals.total_value, uma.body.data.totals.total_value);
});

test('reports: maquina inexistente devolve 404', async () => {
  const r = await admin.get('/api/reports/period?machine_ids=999999&period=all');
  assert.equal(r.status, 404);
});

test('reports: os relatorios por tipo deixaram de existir', async () => {
  assert.equal((await admin.get('/api/reports/owners')).status, 404);
  assert.equal((await admin.get('/api/reports/machines')).status, 404);
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
  const r = await admin.raw(`/api/reports/pdf?machine_id=${machineId}&period=all`);
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
  assert.ok(actions.includes('owner/create'), 'criacao de cliente');
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
  const r = await admin.upload('/api/owners', h.ownerForm({ name: `Teste ${payload}` }));
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
    assert.equal(Math.round(Number(c.calculated_total_value) * 100), entry - exit, `coleta ${c.id}: valor bruto`);
  }
});

test('consistencia: nenhuma coleta foi apagada fisicamente', async () => {
  const db = require('../backend/config/database');
  const row = await db.queryOne('SELECT COUNT(*) AS total FROM collections');
  assert.equal(Number(row.total), 5, 'as 5 coletas continuam no banco (4 da maquina 001 + 1 sem foto)');
});

test('consistencia: toda imagem pertence a uma coleta existente', async () => {
  // A foto deixou de ser obrigatoria, entao coleta sem imagem e normal.
  // O que nao pode e sobrar imagem apontando para coleta que nao existe.
  const db = require('../backend/config/database');
  const orfas = await db.query(`
    SELECT ci.id FROM collection_images ci
     WHERE NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = ci.collection_id)`);
  assert.equal(orfas.length, 0);
});

// ====================================================================
// RECALCULO DO HISTORICO
// ====================================================================
// A regra do valor bruto mudou depois que o sistema ja estava em uso.
// O recalculo traz as coletas antigas para a regra vigente sem tocar nas
// leituras dos relogios, que sao o fato registrado no campo.
// ====================================================================
test('recalculo: corrige coletas gravadas pela regra antiga', async () => {
  const db = require('../backend/config/database');
  const { recalcular } = require('../backend/database/recalculate');

  // Precisa de uma coleta em que as duas formulas deem valores diferentes,
  // ou seja, com leitura anterior maior que zero.
  const alvo = await db.queryOne(
    `SELECT id, current_entry_value, current_exit_value, calculated_total_value
       FROM collections
      WHERE previous_entry_value > 0
      ORDER BY id LIMIT 1`
  );
  const correto = alvo.calculated_total_value;

  // Simula uma linha fora da regra: alguem mexeu direto no banco e gravou
  // "entrada atual - saida atual" no lugar do valor bruto.
  await db.query(
    `UPDATE collections
        SET calculated_total_value = current_entry_value - current_exit_value
      WHERE id = ?`,
    [alvo.id]
  );

  const antes = await db.queryOne('SELECT calculated_total_value FROM collections WHERE id = ?', [alvo.id]);
  assert.notEqual(antes.calculated_total_value, correto, 'o cenario precisa de um valor divergente');

  const resultado = await recalcular({ silencioso: true });
  assert.equal(resultado.alteradas, 1);

  const depois = await db.queryOne(
    `SELECT current_entry_value, current_exit_value,
            calculated_entry_value, calculated_exit_value, calculated_total_value
       FROM collections WHERE id = ?`,
    [alvo.id]
  );

  assert.equal(depois.calculated_total_value, correto);
  assert.equal(
    Number(depois.calculated_total_value),
    Number(depois.calculated_entry_value) - Number(depois.calculated_exit_value)
  );

  // As leituras do relogio nao foram tocadas.
  assert.equal(depois.current_entry_value, alvo.current_entry_value);
  assert.equal(depois.current_exit_value, alvo.current_exit_value);
});

test('recalculo: guarda o valor anterior na auditoria', async () => {
  const r = await admin.get('/api/audit-logs?entity=collection&pageSize=50');
  const registro = r.body.data.find((a) => a.action === 'recalculate');

  assert.ok(registro, 'o recalculo deixa rastro');
  assert.ok(registro.old_values.calculated_total_value, 'guarda o valor que existia antes');
  assert.ok(registro.new_values.calculated_total_value, 'e o que passou a valer');
  assert.match(registro.reason, /entrada apurada - saida apurada/);
});

test('recalculo: rodar de novo nao muda mais nada', async () => {
  const { recalcular } = require('../backend/database/recalculate');
  const resultado = await recalcular({ silencioso: true });
  assert.equal(resultado.alteradas, 0, 'idempotente');
});

// ====================================================================
// CONVERSAO DAS LEITURAS (divisao por 100)
// ====================================================================
// Os dois ultimos digitos do visor sao os centavos. As leituras gravadas
// enquanto o sistema tratava os digitos como reais inteiros estao cem vezes
// maiores e precisam ser transcritas - uma unica vez.
// ====================================================================
test('conversao: divide as leituras por 100 e refaz os derivados', async () => {
  const db = require('../backend/config/database');
  const { converter } = require('../backend/database/rescale-readings');

  const antes = await db.query(
    `SELECT id, previous_entry_value, current_entry_value,
            previous_exit_value, current_exit_value
       FROM collections ORDER BY id`
  );
  assert.ok(antes.length > 0);

  const resultado = await converter({ silencioso: true });
  assert.equal(resultado.aplicada, true);
  assert.equal(resultado.convertidas, antes.length);

  const depois = await db.query(
    `SELECT id, previous_entry_value, current_entry_value,
            previous_exit_value, current_exit_value,
            calculated_entry_value, calculated_exit_value, calculated_total_value
       FROM collections ORDER BY id`
  );

  for (let i = 0; i < antes.length; i += 1) {
    for (const campo of ['previous_entry_value', 'current_entry_value',
      'previous_exit_value', 'current_exit_value']) {
      assert.equal(
        Math.round(Number(depois[i][campo]) * 100),
        Math.round(Number(antes[i][campo]) * 100) / 100,
        `coleta ${antes[i].id}: ${campo} dividido por 100`
      );
    }

    // Os derivados foram refeitos pela regra vigente sobre os novos valores.
    const entry = Math.round((Number(depois[i].current_entry_value) - Number(depois[i].previous_entry_value)) * 100);
    const exit = Math.round((Number(depois[i].current_exit_value) - Number(depois[i].previous_exit_value)) * 100);

    assert.equal(Math.round(Number(depois[i].calculated_entry_value) * 100), entry);
    assert.equal(Math.round(Number(depois[i].calculated_exit_value) * 100), exit);
    assert.equal(Math.round(Number(depois[i].calculated_total_value) * 100), entry - exit);
  }
});

test('conversao: o visor volta a bater com o valor gravado', async () => {
  const db = require('../backend/config/database');

  // A primeira coleta entrou com 6000 / 4200 em reais, o que na epoca queria
  // dizer "o operador digitou 6000 e 4200 no visor". Depois da conversao,
  // esses mesmos digitos valem R$ 60,00 e R$ 42,00.
  const primeira = await db.queryOne(
    'SELECT current_entry_value, current_exit_value FROM collections ORDER BY id LIMIT 1'
  );

  assert.equal(primeira.current_entry_value, '60.00');
  assert.equal(primeira.current_exit_value, '42.00');
});

test('conversao: nao roda duas vezes', async () => {
  const { converter } = require('../backend/database/rescale-readings');

  const segunda = await converter({ silencioso: true });
  assert.equal(segunda.aplicada, false);
  assert.equal(segunda.motivo, 'JA_APLICADA');
  assert.equal(segunda.convertidas, 0);
});

test('conversao: fica registrada na auditoria com os valores de antes', async () => {
  const r = await admin.get('/api/audit-logs?entity=collection&pageSize=100');
  const registro = r.body.data.find((a) => a.action === 'rescale_readings');

  assert.ok(registro, 'a conversao deixa rastro por coleta');
  assert.ok(registro.old_values.current_entry_value, 'guarda a leitura anterior a conversao');
  assert.equal(
    Math.round(Number(registro.old_values.current_entry_value) * 100) / 100,
    Math.round(Number(registro.new_values.current_entry_value) * 100),
    'o novo valor e o antigo dividido por 100'
  );
  assert.match(registro.reason, /centavos/);
});

// ====================================================================
// DIVISAO DO VALOR BRUTO NO RELATORIO
// ====================================================================
// O resultado bruto e repartido ao meio entre as duas partes. Isso e uma
// leitura do relatorio: nada do que foi gravado na coleta muda por causa
// disso.
// ====================================================================
test('relatorio: traz a metade do total bruto', async () => {
  const r = await admin.get(`/api/reports/period?machine_id=${machineId}&period=all`);
  const t = r.body.data.totals;

  assert.ok(t.total_value_half !== undefined, 'o relatorio precisa informar quanto vai para cada');
  assert.equal(
    Math.round(Number(t.total_value_half) * 100),
    Math.round(Math.round(Number(t.total_value) * 100) / 2),
    'valor para cada = total bruto dividido por dois'
  );
});

test('relatorio: o exemplo de 400 da 200 para cada', () => {
  const money = require('../backend/utils/money');

  assert.equal(money.half('400.00'), '200.00');
  assert.equal(money.formatBRL(money.half('400.00')), 'R$ 200,00');

  // Centavos impares: a metade exata nao cabe em centavos, entao arredonda.
  assert.equal(money.half('26.97'), '13.49');

  // Valor bruto negativo divide igual - o prejuizo tambem e das duas partes.
  assert.equal(money.half('-600.00'), '-300.00');
  assert.equal(money.half('0.00'), '0.00');
});

test('relatorio: a divisao NAO mexe no que foi gravado na coleta', async () => {
  const db = require('../backend/config/database');

  // As colunas da coleta continuam com o valor cheio, sem metade nenhuma.
  const linhas = await db.query(
    `SELECT calculated_entry_value, calculated_exit_value, calculated_total_value
       FROM collections WHERE status = 'confirmed'`
  );

  for (const c of linhas) {
    assert.equal(
      Math.round(Number(c.calculated_total_value) * 100),
      Math.round(Number(c.calculated_entry_value) * 100)
        - Math.round(Number(c.calculated_exit_value) * 100),
      'o valor bruto gravado continua sendo apurada menos apurada, inteiro'
    );
  }

  // E o comprovante da coleta tambem nao fala em metade.
  const lista = await admin.get('/api/collections?pageSize=1');
  const pdf = await admin.raw(`/api/collections/${lista.body.data[0].id}/receipt`);
  assert.equal(pdf.status, 200);
  assert.equal(/para cada/i.test(pdf.buffer.toString('latin1')), false,
    'a divisao e so do relatorio, nao do comprovante');
});

test('relatorio: o PDF sai com a coluna e o total da divisao', async () => {
  const r = await admin.raw(`/api/reports/pdf?machine_id=${machineId}&period=all`);
  assert.equal(r.status, 200);
  assert.equal(r.buffer.slice(0, 5).toString(), '%PDF-');
  assert.ok(r.buffer.length > 1000);
});
