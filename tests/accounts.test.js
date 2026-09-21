'use strict';

/**
 * SEPARACAO ENTRE AS DUAS CONTAS.
 *
 * As contas sao sistemas fechados: cada uma tem seus clientes, maquinas,
 * coletas, usuarios e auditoria, e nada atravessa de uma para a outra.
 *
 * Estes testes nao se contentam em conferir que a listagem veio vazia. Eles
 * tentam FURAR a barreira por todos os caminhos que existem - id direto na
 * URL, relatorio, PDF, imagem, exclusao, vinculo cruzado - porque e assim que
 * um vazamento aconteceria de verdade: nao pela porta da frente.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');

let anon;
let contaA;          // admin da primeira conta
let contaB;          // admin da segunda conta
let dadosA = {};     // o que existe dentro da conta A
let dadosB = {};

const SENHA_B = 'Megaplay@2026';

test.before(async () => {
  await h.resetDatabase();
  await h.startServer();
  h.cleanUploads();

  anon = h.client();

  // ---- Conta A: a que ja existia ----
  const sessaoA = await h.loginFull();
  contaA = h.client(sessaoA.token);
  dadosA.accountId = sessaoA.user.account_id;

  const clienteA = await contaA.upload('/api/owners', h.ownerForm({
    name: 'Cliente da Conta A', document: '11144477735'
  }));
  dadosA.ownerId = clienteA.body.data.id;

  const maquinaA = await contaA.post('/api/machines', {
    number: '001', name: 'Maquina da Conta A', owner_id: dadosA.ownerId
  });
  dadosA.machineId = maquinaA.body.data.id;

  const coletaA = await contaA.upload('/api/collections', h.collectionForm({
    machine_id: dadosA.machineId, current_entry_value: '100000', current_exit_value: '40000'
  }));
  dadosA.collectionId = coletaA.body.data.id;
  dadosA.imageId = coletaA.body.data.images[0].id;

  // ---- Conta B: nasce com senha temporaria ----
  const temporaria = global.__SENHA_TMP__;
  const primeiro = await anon.post('/api/auth/login', {
    email: 'megaplay@gmail.com', password: temporaria
  });
  const cliente = h.client(primeiro.body.data.token);
  await cliente.post('/api/auth/change-password', {
    currentPassword: temporaria, newPassword: SENHA_B
  });

  const sessaoB = await h.loginFull('megaplay@gmail.com', SENHA_B);
  contaB = h.client(sessaoB.token);
  dadosB.accountId = sessaoB.user.account_id;
});

test.after(async () => {
  h.cleanUploads();
  await h.stopServer();
});

// ====================================================================
// AS DUAS CONTAS EXISTEM E SAO DIFERENTES
// ====================================================================
test('as duas contas sao independentes', () => {
  assert.notEqual(dadosA.accountId, dadosB.accountId);
});

test('a lista publica de contas mostra o nome e mais nada', async () => {
  const r = await anon.get('/api/auth/accounts');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 2);

  for (const conta of r.body.data) {
    assert.deepEqual(Object.keys(conta).sort(), ['id', 'name'],
      'a lista publica nao pode revelar nada alem do nome');
  }
});

// ====================================================================
// SENHA TEMPORARIA
// ====================================================================
test('senha temporaria fecha o sistema ate ser trocada', async () => {
  await h.resetSegundaConta();

  const temporaria = global.__SENHA_TMP__;
  const entrada = await anon.post('/api/auth/login', {
    email: 'megaplay@gmail.com', password: temporaria
  });

  assert.equal(entrada.status, 200, 'o login funciona');
  assert.equal(entrada.body.data.user.must_change_password, true);

  const novo = h.client(entrada.body.data.token);

  // Nada do sistema responde antes da troca.
  for (const rota of ['/api/owners', '/api/machines', '/api/collections',
    '/api/dashboard', '/api/users', '/api/reports/own']) {
    const r = await novo.get(rota);
    assert.equal(r.status, 403, `${rota} deveria estar fechada`);
    assert.equal(r.body.error, 'PASSWORD_CHANGE_REQUIRED');
  }

  // A troca de senha, sim.
  const troca = await novo.post('/api/auth/change-password', {
    currentPassword: temporaria, newPassword: SENHA_B
  });
  assert.equal(troca.status, 200);

  // E agora o sistema abre.
  const depois = h.client((await h.loginFull('megaplay@gmail.com', SENHA_B)).token);
  assert.equal((await depois.get('/api/owners')).status, 200);

  const perfil = await depois.get('/api/auth/me');
  assert.equal(perfil.body.data.must_change_password, false, 'a exigencia caiu');

  contaB = depois;
});

// ====================================================================
// LEITURA: A CONTA B NAO ENXERGA NADA DA CONTA A
// ====================================================================
test('listagens da conta B vem vazias', async () => {
  assert.equal((await contaB.get('/api/owners')).body.data.length, 0);
  assert.equal((await contaB.get('/api/machines')).body.data.length, 0);
  assert.equal((await contaB.get('/api/collections')).body.data.length, 0);
});

test('acesso por id direto responde 404, nao 403', async () => {
  // 404 e proposital: 403 confirmaria que o registro existe em algum lugar.
  assert.equal((await contaB.get(`/api/owners/${dadosA.ownerId}`)).status, 404);
  assert.equal((await contaB.get(`/api/machines/${dadosA.machineId}`)).status, 404);
  assert.equal((await contaB.get(`/api/collections/${dadosA.collectionId}`)).status, 404);
});

test('as telas derivadas tambem nao vazam', async () => {
  assert.equal((await contaB.get(`/api/owners/${dadosA.ownerId}/machines`)).body.data.length, 0);
  assert.equal((await contaB.get(`/api/owners/${dadosA.ownerId}/collections`)).body.data.length, 0);
  assert.equal((await contaB.get(`/api/machines/${dadosA.machineId}/collections`)).body.data.length, 0);
  assert.equal((await contaB.get(`/api/machines/${dadosA.machineId}/last-reading`)).status, 404);
});

test('o dashboard da conta B conta apenas o que e dela', async () => {
  const r = await contaB.get('/api/dashboard');
  const m = r.body.data.metrics;

  assert.equal(m.owners_total, 0);
  assert.equal(m.machines_total, 0);
  assert.equal(m.collections_count, 0);
  assert.equal(Number(m.total_value), 0);
  assert.equal(r.body.data.latest_collections.length, 0);
});

test('a busca global nao encontra o que e da outra conta', async () => {
  const r = await contaB.get('/api/search?q=Conta%20A');
  assert.equal(r.body.data.total, 0);

  const porNumero = await contaB.get('/api/search?q=001');
  assert.equal(porNumero.body.data.total, 0);
});

test('o relatorio ignora as maquinas da outra conta mesmo com o id na mao', async () => {
  const geral = await contaB.get('/api/reports/period?period=all');
  assert.equal(geral.body.data.rows.length, 0);
  assert.equal(Number(geral.body.data.totals.total_value), 0);

  // Apontando direto para a maquina da conta A.
  const dirigido = await contaB.get(`/api/reports/period?machine_ids=${dadosA.machineId}&period=all`);
  assert.equal(dirigido.status, 404, 'a maquina da outra conta nao existe daqui');

  // E pelo cliente da conta A.
  const porCliente = await contaB.get(`/api/reports/period?owner_id=${dadosA.ownerId}&period=all`);
  assert.equal(porCliente.status, 404);
});

test('comprovantes e imagens da conta A nao abrem na conta B', async () => {
  assert.equal((await contaB.raw(`/api/collections/${dadosA.collectionId}/receipt`)).status, 404);
  assert.equal((await contaB.raw(`/api/collections/images/${dadosA.imageId}`)).status, 404);
  assert.equal((await contaB.raw(`/api/owners/${dadosA.ownerId}/document-photo`)).status, 404);
});

test('a auditoria de cada conta e separada', async () => {
  const a = await contaA.get('/api/audit-logs?pageSize=100&period=all');
  const b = await contaB.get('/api/audit-logs?pageSize=100&period=all');

  assert.ok(a.body.data.length > 0, 'a conta A tem historico');

  const entidadesDeA = a.body.data.map((l) => `${l.entity}/${l.entity_id}`);
  const entidadesDeB = b.body.data.map((l) => `${l.entity}/${l.entity_id}`);

  assert.ok(entidadesDeA.includes(`owner/${dadosA.ownerId}`));
  assert.equal(entidadesDeB.includes(`owner/${dadosA.ownerId}`), false,
    'a conta B nao ve o que aconteceu na conta A');
});

test('usuarios: cada admin ve apenas a propria equipe', async () => {
  const a = await contaA.get('/api/users?pageSize=100');
  const b = await contaB.get('/api/users?pageSize=100');

  const emailsA = a.body.data.map((u) => u.email);
  const emailsB = b.body.data.map((u) => u.email);

  assert.ok(emailsA.includes('admin@sistema.local'));
  assert.equal(emailsA.includes('megaplay@gmail.com'), false);

  assert.ok(emailsB.includes('megaplay@gmail.com'));
  assert.equal(emailsB.includes('admin@sistema.local'), false);
});

// ====================================================================
// ESCRITA: A CONTA B NAO ALTERA NADA DA CONTA A
// ====================================================================
test('a conta B nao edita nem desativa registros da conta A', async () => {
  const edicao = await contaB.uploadPut(`/api/owners/${dadosA.ownerId}`, h.ownerForm({
    name: 'Sequestrado', document: '11144477735'
  }, false));
  assert.equal(edicao.status, 404);

  const status = await contaB.patch(`/api/owners/${dadosA.ownerId}/status`, { status: 'inactive' });
  assert.equal(status.status, 404);

  const maquina = await contaB.put(`/api/machines/${dadosA.machineId}`, {
    number: '001', name: 'Sequestrada', owner_id: dadosA.ownerId
  });
  assert.equal(maquina.status, 404);

  // E nada mudou de verdade.
  const conferencia = await contaA.get(`/api/owners/${dadosA.ownerId}`);
  assert.equal(conferencia.body.data.name, 'Cliente da Conta A');
});

test('a conta B nao apaga nem cancela nada da conta A', async () => {
  assert.equal((await contaB.del(`/api/owners/${dadosA.ownerId}`)).status, 404);
  assert.equal((await contaB.del(`/api/owners/${dadosA.ownerId}?cascade=1`)).status, 404);
  assert.equal((await contaB.del(`/api/machines/${dadosA.machineId}`)).status, 404);

  const cancelamento = await contaB.post(`/api/collections/${dadosA.collectionId}/cancel`, {
    reason: 'Tentativa de cancelar coleta da outra conta.'
  });
  assert.equal(cancelamento.status, 404);

  // Tudo continua de pe na conta A.
  assert.equal((await contaA.get(`/api/owners/${dadosA.ownerId}`)).status, 200);
  assert.equal((await contaA.get(`/api/collections/${dadosA.collectionId}`)).body.data.status, 'confirmed');
});

test('a conta B nao apaga nem promove usuarios da conta A', async () => {
  const listaA = await contaA.get('/api/users?pageSize=100');
  const adminA = listaA.body.data.find((u) => u.email === 'admin@sistema.local');

  assert.equal((await contaB.del(`/api/users/${adminA.id}`)).status, 404);
  assert.equal((await contaB.patch(`/api/users/${adminA.id}/status`, { status: 'inactive' })).status, 404);
  assert.equal((await contaB.post(`/api/users/${adminA.id}/reset-password`, { password: 'Invadida@123' })).status, 404);

  // O admin da conta A continua entrando com a senha dele.
  const ainda = await anon.post('/api/auth/login', {
    email: 'admin@sistema.local', password: 'Admin@123'
  });
  assert.equal(ainda.status, 200);
});

test('nao da para criar maquina apontando para cliente da outra conta', async () => {
  const clienteB = await contaB.upload('/api/owners', h.ownerForm({
    name: 'Cliente da Conta B', document: '52998224725'
  }));
  dadosB.ownerId = clienteB.body.data.id;

  // O caminho mais silencioso de furar a separacao: vincular por id.
  const r = await contaB.post('/api/machines', {
    number: 'X-1', name: 'Maquina Cruzada', owner_id: dadosA.ownerId
  });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.owner_id);
});

test('nao da para registrar coleta na maquina da outra conta', async () => {
  const r = await contaB.upload('/api/collections', h.collectionForm({
    machine_id: dadosA.machineId, current_entry_value: '999999', current_exit_value: '1'
  }));
  assert.equal(r.status, 404);

  // A leitura da maquina da conta A nao mudou.
  const leitura = await contaA.get(`/api/machines/${dadosA.machineId}/last-reading`);
  assert.equal(leitura.body.data.last_collection.entry_value, '100000.00');
});

// ====================================================================
// AS DUAS CONTAS CONVIVEM SEM SE ATRAPALHAR
// ====================================================================
test('as duas contas podem ter o mesmo numero de maquina e o mesmo CPF', async () => {
  const mesmoCpf = await contaB.upload('/api/owners', h.ownerForm({
    name: 'Mesmo CPF da Conta A', document: '11144477735'
  }));
  assert.equal(mesmoCpf.status, 201, 'o CPF e unico dentro da conta, nao no sistema');

  const mesmaMaquina = await contaB.post('/api/machines', {
    number: '001', name: 'Maquina da Conta B', owner_id: mesmoCpf.body.data.id
  });
  assert.equal(mesmaMaquina.status, 201, 'o numero e unico dentro da conta');

  // E continuam distinguiveis.
  assert.equal((await contaA.get('/api/machines')).body.data.length, 1);
  assert.equal((await contaB.get('/api/machines')).body.data.length, 1);
});

test('o e-mail de login continua unico no sistema inteiro', async () => {
  // Duas pessoas em contas diferentes nao podem disputar o mesmo login.
  const r = await contaB.post('/api/users', {
    name: 'Clone do Admin', email: 'admin@sistema.local',
    role: 'operator', password: 'Clone@12345'
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'DUPLICATE_EMAIL');
  assert.equal(r.body.message.includes('Administrador'), false,
    'a mensagem nao revela nada sobre a conta alheia');
});

test('o trabalho da conta B nao aparece na conta A', async () => {
  const coletaB = await contaB.upload('/api/collections', h.collectionForm({
    machine_id: (await contaB.get('/api/machines')).body.data[0].id,
    current_entry_value: '5000', current_exit_value: '2000'
  }));
  assert.equal(coletaB.status, 201);

  const relatorioA = await contaA.get('/api/reports/period?period=all');
  const idsA = relatorioA.body.data.rows.map((l) => l.id);
  assert.equal(idsA.includes(coletaB.body.data.id), false);

  assert.equal((await contaA.get('/api/dashboard')).body.data.metrics.owners_total, 1,
    'a conta A continua com um cliente so');
});

// ====================================================================
// A GUARDA DO CODIGO
// ====================================================================
test('consulta sem conta definida falha em vez de vazar', () => {
  const { exigirConta } = require('../backend/utils/tenant');

  assert.equal(exigirConta(7), 7);
  for (const invalido of [null, undefined, 0, -1, 'abc', NaN]) {
    assert.throws(() => exigirConta(invalido), /Consulta sem conta definida/,
      `${String(invalido)} deveria derrubar a consulta`);
  }
});

test('nenhum registro do banco ficou sem conta', async () => {
  const db = require('../backend/config/database');

  for (const tabela of ['users', 'owners', 'machines', 'collections']) {
    const r = await db.queryOne(`SELECT COUNT(*) AS total FROM \`${tabela}\` WHERE account_id IS NULL`);
    assert.equal(Number(r.total), 0, `${tabela} tem linha sem conta`);
  }
});
