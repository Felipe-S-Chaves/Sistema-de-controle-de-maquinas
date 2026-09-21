'use strict';

/**
 * Perfis de acesso.
 *
 * O administrador faz tudo. O operador cadastra e coleta, mas nao gerencia
 * nem enxerga o negocio dos outros. O somente-leitura ve e nao altera.
 *
 * Estes testes existem para que uma mudanca futura nao abra silenciosamente
 * uma porta que deveria continuar fechada.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');
const { pode, permissoesDoPapel } = require('../backend/config/permissions');

let admin;
let operador;
let anon;
let contaDoAdmin;
let ownerId;
let machineId;
let coletaDoOperador;
let coletaDoAdmin;

test.before(async () => {
  await h.resetDatabase();
  await h.startServer();
  h.cleanUploads();

  anon = h.client();
  const sessaoAdmin = await h.loginFull();
  admin = h.client(sessaoAdmin.token);
  contaDoAdmin = sessaoAdmin.user.account_id;

  // O admin cria os outros perfis.
  await admin.post('/api/users', {
    name: 'Carlos Operador', email: 'operador@teste.local', role: 'operator', password: 'Operador@123'
  });

  operador = h.client(await h.login('operador@teste.local', 'Operador@123'));

  const owner = await admin.upload('/api/owners', h.ownerForm({ name: 'João da Silva', document: '11144477735' }));
  ownerId = owner.body.data.id;

  const machine = await admin.post('/api/machines', {
    number: '001', name: 'Máquina Principal', owner_id: ownerId
  });
  machineId = machine.body.data.id;

  const doOperador = await operador.upload('/api/collections', h.collectionForm({
    machine_id: machineId,
    previous_entry_value: '1000', previous_exit_value: '500',
    current_entry_value: '2000', current_exit_value: '800'
  }));
  coletaDoOperador = doOperador.body.data.id;

  const doAdmin = await admin.upload('/api/collections', h.collectionForm({
    machine_id: machineId, current_entry_value: '3000', current_exit_value: '1000'
  }));
  coletaDoAdmin = doAdmin.body.data.id;
});

test.after(async () => {
  h.cleanUploads();
  await h.stopServer();
});

// ====================================================================
// TABELA DE PERMISSOES
// ====================================================================
test('a tabela de permissoes reflete os perfis combinados', () => {
  assert.equal(pode('admin', 'users.manage'), true);
  assert.equal(pode('admin', 'collections.cancel'), true);
  assert.equal(pode('admin', 'reports.view'), true);

  assert.deepEqual(permissoesDoPapel('operator').sort(), [
    'collections.create', 'collections.receipt', 'collections.viewOwn',
    'machines.create', 'owners.create', 'reports.own'
  ]);

  assert.equal(pode('operator', 'owners.update'), false, 'operador nao edita');
  assert.equal(pode('operator', 'collections.cancel'), false, 'operador nao cancela');
  assert.equal(pode('operator', 'reports.view'), false, 'operador nao ve relatorios');
  assert.equal(pode('operator', 'audit.view'), false, 'operador nao ve auditoria');
  assert.equal(pode('operator', 'users.manage'), false, 'operador nao gerencia usuarios');
  assert.equal(pode('operator', 'dashboard.full'), false, 'operador nao tem dashboard');
  assert.equal(pode('operator', 'owners.view'), false, 'operador nao tem a busca global');

  // O sistema tem exatamente dois perfis.
  assert.deepEqual(Object.keys(require('../backend/config/permissions').PAPEIS), ['admin', 'operator']);
  assert.deepEqual(permissoesDoPapel('viewer'), [], 'o perfil "viewer" nao existe mais');
});

test('o login devolve as permissoes do papel', async () => {
  const r = await anon.post('/api/auth/login', { email: 'operador@teste.local', password: 'Operador@123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.user.role, 'operator');
  assert.equal(r.body.data.user.role_label, 'Operador');
  assert.ok(r.body.data.user.permissions.includes('collections.create'));
  assert.equal(r.body.data.user.permissions.includes('reports.view'), false);
});

// ====================================================================
// OPERADOR: o que PODE
// ====================================================================
test('operador: cadastra cliente', async () => {
  const r = await operador.upload('/api/owners', h.ownerForm({ name: 'Maria Oliveira', document: '52998224725' }));
  assert.equal(r.status, 201);
});

test('operador: cadastra maquina', async () => {
  const r = await operador.post('/api/machines', {
    number: '002', name: 'Máquina do Operador', owner_id: ownerId
  });
  assert.equal(r.status, 201);
});

test('operador: registra coleta e ve o proprio apurado', async () => {
  const detalhe = await operador.get(`/api/collections/${coletaDoOperador}`);
  assert.equal(detalhe.status, 200);
  assert.equal(detalhe.body.data.calculated_total_value, '700.00');   // 1000 - 300
});

test('operador: consulta a ultima leitura para poder coletar', async () => {
  const r = await operador.get(`/api/machines/${machineId}/last-reading`);
  assert.equal(r.status, 200);
});

test('operador: lista clientes e maquinas para montar a coleta', async () => {
  assert.equal((await operador.get('/api/owners')).status, 200);
  assert.equal((await operador.get(`/api/owners/${ownerId}/machines`)).status, 200);
});

// ====================================================================
// OPERADOR: o que NAO pode
// ====================================================================
test('operador: nao edita cliente nem maquina', async () => {
  const owner = await operador.put(`/api/owners/${ownerId}`, { name: 'Alterado', document: '11144477735' });
  assert.equal(owner.status, 403);

  const machine = await operador.put(`/api/machines/${machineId}`, {
    number: '001', name: 'Alterada', owner_id: ownerId
  });
  assert.equal(machine.status, 403);

  const status = await operador.patch(`/api/machines/${machineId}/status`, { status: 'maintenance' });
  assert.equal(status.status, 403);
});

test('operador: nao cancela coleta, nem a propria', async () => {
  const r = await operador.post(`/api/collections/${coletaDoOperador}/cancel`, {
    reason: 'Tentativa de cancelamento pelo operador.'
  });
  assert.equal(r.status, 403);
});

test('operador: nao acessa os relatorios do negocio', async () => {
  assert.equal((await operador.get('/api/reports/period')).status, 403);
  assert.equal((await operador.get('/api/reports/period?machine_ids=1,2')).status, 403);
  assert.equal((await operador.get('/api/reports/pdf')).status, 403);
});

// ====================================================================
// PDF DO OPERADOR: comprovante e relatorio das proprias coletas
// ====================================================================
test('operador: emite o comprovante em PDF da propria coleta', async () => {
  const r = await operador.raw(`/api/collections/${coletaDoOperador}/receipt`);
  assert.equal(r.status, 200);
  assert.equal(r.response.headers.get('content-type'), 'application/pdf');
  assert.equal(r.buffer.slice(0, 5).toString(), '%PDF-');
  assert.ok(r.buffer.length > 1000, 'PDF com conteudo');
  assert.match(
    r.response.headers.get('content-disposition') || '',
    /comprovante-coleta-\d+\.pdf/
  );
});

test('operador: NAO emite o comprovante da coleta de outra pessoa', async () => {
  const r = await operador.get(`/api/collections/${coletaDoAdmin}/receipt`);
  assert.equal(r.status, 403);
});

test('operador: gera o relatorio das proprias coletas', async () => {
  const r = await operador.get('/api/reports/own?period=all');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.scope, 'own');
  assert.equal(r.body.data.operator, 'Carlos Operador');

  // So a coleta dele, nunca a do admin.
  assert.equal(r.body.data.rows.length, 1);
  assert.equal(r.body.data.rows[0].id, coletaDoOperador);
  assert.equal(r.body.data.totals.collections_count, 1);
  assert.equal(r.body.data.totals.total_value, '700.00');   // 1000 - 300
});

test('operador: o relatorio proprio ignora user_id vindo da query', async () => {
  // Tentativa de espiar o trabalho de outra pessoa forjando o parametro.
  const outro = await admin.get('/api/users?pageSize=100');
  const idDoAdmin = outro.body.data.find((u) => u.email === 'admin@sistema.local').id;

  const r = await operador.get(`/api/reports/own?period=all&user_id=${idDoAdmin}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.operator, 'Carlos Operador', 'continua sendo o relatorio dele');
  assert.equal(r.body.data.rows.length, 1);
  assert.equal(r.body.data.rows[0].id, coletaDoOperador);
});

test('operador: gera o PDF do relatorio proprio', async () => {
  const r = await operador.raw('/api/reports/own/pdf?period=all');
  assert.equal(r.status, 200);
  assert.equal(r.response.headers.get('content-type'), 'application/pdf');
  assert.equal(r.buffer.slice(0, 5).toString(), '%PDF-');
  assert.match(r.response.headers.get('content-disposition') || '', /minhas-coletas-/);
});

test('admin: tambem emite comprovante e relatorio proprio', async () => {
  const comprovante = await admin.raw(`/api/collections/${coletaDoAdmin}/receipt`);
  assert.equal(comprovante.status, 200);

  const proprio = await admin.get('/api/reports/own?period=all');
  assert.equal(proprio.status, 200);
  assert.equal(proprio.body.data.rows.length, 1, 'so as coletas do proprio admin');
});

test('sem token: comprovante e relatorio proprio exigem autenticacao', async () => {
  assert.equal((await anon.get(`/api/collections/${coletaDoOperador}/receipt`)).status, 401);
  assert.equal((await anon.get('/api/reports/own')).status, 401);
});

test('operador: nao acessa auditoria nem usuarios', async () => {
  assert.equal((await operador.get('/api/audit-logs')).status, 403);
  assert.equal((await operador.get('/api/users')).status, 403);

  const criar = await operador.post('/api/users', {
    name: 'Invasor', email: 'invasor@teste.local', role: 'admin', password: 'Invasor@123'
  });
  assert.equal(criar.status, 403, 'operador nao pode se promover a admin');
});

test('operador: nao ve o historico financeiro das maquinas', async () => {
  assert.equal((await operador.get(`/api/machines/${machineId}/collections`)).status, 403);
  assert.equal((await operador.get(`/api/owners/${ownerId}/collections`)).status, 403);
});

// ====================================================================
// ISOLAMENTO ENTRE USUARIOS
// ====================================================================
test('operador: enxerga apenas as coletas que registrou', async () => {
  const r = await operador.get('/api/collections');
  assert.equal(r.status, 200);
  assert.equal(r.body.pagination.total, 1, 'so a dele');
  assert.equal(r.body.data[0].id, coletaDoOperador);
});

test('operador: nao abre a coleta de outra pessoa', async () => {
  const r = await operador.get(`/api/collections/${coletaDoAdmin}`);
  assert.equal(r.status, 403);
});

test('operador: nao acessa o comprovante de outra pessoa', async () => {
  const detalhe = await admin.get(`/api/collections/${coletaDoAdmin}`);
  const imagemId = detalhe.body.data.images[0].id;

  const r = await operador.get(`/api/collections/images/${imagemId}`);
  assert.equal(r.status, 403);
});

test('operador: acessa o comprovante da propria coleta', async () => {
  const detalhe = await operador.get(`/api/collections/${coletaDoOperador}`);
  const imagemId = detalhe.body.data.images[0].id;

  const r = await operador.raw(`/api/collections/images/${imagemId}`);
  assert.equal(r.status, 200);
});

test('admin: enxerga as coletas de todos', async () => {
  const r = await admin.get('/api/collections');
  assert.equal(r.body.pagination.total, 2);
});

// ====================================================================
// PAINEL SEM VAZAMENTO FINANCEIRO
// ====================================================================
test('operador: nao tem acesso ao dashboard nem a busca global', async () => {
  assert.equal((await operador.get('/api/dashboard')).status, 403);
  assert.equal((await operador.get('/api/dashboard?period=all')).status, 403);
  assert.equal((await operador.get('/api/search?q=001')).status, 403);
});

test('admin: o painel traz os totais do negocio', async () => {
  const r = await admin.get('/api/dashboard?period=all');
  assert.equal(r.status, 200);

  const chaves = Object.keys(r.body.data.metrics);
  assert.ok(chaves.includes('total_value'));
  assert.ok(chaves.includes('total_entry'));
  assert.ok(chaves.includes('total_exit'));
  assert.ok(Array.isArray(r.body.data.monthly_series));
});

// ====================================================================
// GERENCIAMENTO DE USUARIOS
// ====================================================================
// ====================================================================
// AUTO-CADASTRO PELA TELA DE LOGIN
// ====================================================================
test('auto-cadastro: cria a conta AGUARDANDO liberacao do administrador', async () => {
  const r = await anon.post('/api/auth/register', {
    account_id: contaDoAdmin,
    name: 'Pedro Campo', email: 'pedro@campo.local',
    password: 'Pedro@12345', passwordConfirm: 'Pedro@12345'
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.pending, true);

  // A conta existe, mas inativa e como operador.
  const lista = await admin.get('/api/users?pageSize=100');
  const criado = lista.body.data.find((u) => u.email === 'pedro@campo.local');
  assert.ok(criado, 'conta foi criada');
  assert.equal(criado.role, 'operator');
  assert.equal(criado.status, 'inactive', 'nasce aguardando liberacao');
});

test('auto-cadastro: a conta nao entra antes de ser liberada', async () => {
  const r = await anon.post('/api/auth/login', {
    email: 'pedro@campo.local', password: 'Pedro@12345'
  });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /nao foi liberada/i);
});

test('auto-cadastro: nao da para se cadastrar como administrador', async () => {
  await anon.post('/api/auth/register', {
    account_id: contaDoAdmin,
    name: 'Invasor Silva', email: 'invasor@campo.local',
    password: 'Invasor@123', passwordConfirm: 'Invasor@123',
    role: 'admin', status: 'active'
  });

  const lista = await admin.get('/api/users?pageSize=100');
  const criado = lista.body.data.find((u) => u.email === 'invasor@campo.local');
  assert.equal(criado.role, 'operator', 'o papel enviado no corpo e ignorado');
  assert.equal(criado.status, 'inactive', 'o status enviado no corpo e ignorado');
});

test('auto-cadastro: e-mail ja existente nao revela nada nem duplica', async () => {
  const r = await anon.post('/api/auth/register', {
    account_id: contaDoAdmin,
    name: 'Outra Pessoa', email: 'pedro@campo.local',
    password: 'Outro@12345', passwordConfirm: 'Outro@12345'
  });
  assert.equal(r.status, 201, 'mesma resposta do sucesso');

  const lista = await admin.get('/api/users?pageSize=100');
  const iguais = lista.body.data.filter((u) => u.email === 'pedro@campo.local');
  assert.equal(iguais.length, 1, 'nao criou um segundo registro');
  assert.equal(iguais[0].name, 'Pedro Campo', 'o cadastro original nao foi sobrescrito');
});

test('auto-cadastro: validacoes de nome, e-mail e senha', async () => {
  const curta = await anon.post('/api/auth/register', {
    account_id: contaDoAdmin,
    name: 'Fulano Teste', email: 'curta@campo.local',
    password: '123', passwordConfirm: '123'
  });
  assert.equal(curta.status, 422);
  assert.ok(curta.body.details.password);

  const divergente = await anon.post('/api/auth/register', {
    account_id: contaDoAdmin,
    name: 'Fulano Teste', email: 'div@campo.local',
    password: 'Senha@12345', passwordConfirm: 'Outra@12345'
  });
  assert.equal(divergente.status, 422);
  assert.ok(divergente.body.details.passwordConfirm);

  const semNome = await anon.post('/api/auth/register', {
    account_id: contaDoAdmin,
    email: 'semnome@campo.local', password: 'Senha@12345', passwordConfirm: 'Senha@12345'
  });
  assert.equal(semNome.status, 422);
  assert.ok(semNome.body.details.name);
});

test('auto-cadastro: depois de liberado, o operador entra e trabalha', async () => {
  const lista = await admin.get('/api/users?pageSize=100');
  const pedro = lista.body.data.find((u) => u.email === 'pedro@campo.local');

  const liberado = await admin.patch(`/api/users/${pedro.id}/status`, { status: 'active' });
  assert.equal(liberado.body.data.status, 'active');

  const entrada = await anon.post('/api/auth/login', {
    email: 'pedro@campo.local', password: 'Pedro@12345'
  });
  assert.equal(entrada.status, 200);
  assert.equal(entrada.body.data.user.role, 'operator');

  const pedroClient = h.client(entrada.body.data.token);
  assert.equal((await pedroClient.upload('/api/owners', h.ownerForm({ name: 'Cliente do Pedro' }))).status, 201);
  assert.equal((await pedroClient.get('/api/reports/own?period=all')).status, 200);
  assert.equal((await pedroClient.get('/api/reports/period')).status, 403);
  assert.equal((await pedroClient.get('/api/users')).status, 403);
  assert.equal((await pedroClient.get('/api/dashboard')).status, 403);
});

test('auto-cadastro: a conta escolhida precisa existir', async () => {
  const r = await anon.post('/api/auth/register', {
    account_id: 9999,
    name: 'Conta Fantasma', email: 'fantasma@campo.local',
    password: 'Senha@12345', passwordConfirm: 'Senha@12345'
  });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.account_id);
});

test('auto-cadastro: a pessoa entra na conta que escolheu', async () => {
  const contas = await anon.get('/api/auth/accounts');
  const outra = contas.body.data.find((c) => c.id !== contaDoAdmin);
  assert.ok(outra, 'o sistema tem duas contas');

  const r = await anon.post('/api/auth/register', {
    account_id: outra.id,
    name: 'Gente da Outra Conta', email: 'outra@campo.local',
    password: 'Outra@12345', passwordConfirm: 'Outra@12345'
  });
  assert.equal(r.status, 201);

  // O admin desta conta NAO ve quem se cadastrou na outra.
  const lista = await admin.get('/api/users?pageSize=100');
  assert.equal(lista.body.data.some((u) => u.email === 'outra@campo.local'), false,
    'cada admin so enxerga os usuarios da propria conta');
});

test('auto-cadastro: fica registrado na auditoria', async () => {
  const r = await admin.get('/api/audit-logs?entity=user&pageSize=50&period=all');
  const acoes = r.body.data.map((a) => a.action);
  assert.ok(acoes.includes('self_register'), 'o auto-cadastro e auditado');
});

test('admin: cria, edita e desativa usuarios', async () => {
  const criado = await admin.post('/api/users', {
    name: 'Pedro Campo', email: 'pedro@teste.local', role: 'operator', password: 'Pedro@12345'
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.body.data.password_hash, undefined, 'hash nunca sai na resposta');

  const id = criado.body.data.id;

  const editado = await admin.put(`/api/users/${id}`, {
    name: 'Pedro Campo Silva', email: 'pedro@teste.local', role: 'operator', status: 'active'
  });
  assert.equal(editado.status, 200);
  assert.equal(editado.body.data.name, 'Pedro Campo Silva');

  const desativado = await admin.patch(`/api/users/${id}/status`, { status: 'inactive' });
  assert.equal(desativado.body.data.status, 'inactive');

  // Usuario inativo nao entra.
  const tentativa = await anon.post('/api/auth/login', {
    email: 'pedro@teste.local', password: 'Pedro@12345'
  });
  assert.equal(tentativa.status, 403);
});

test('admin: e-mail duplicado e recusado', async () => {
  const r = await admin.post('/api/users', {
    name: 'Outro', email: 'operador@teste.local', role: 'operator', password: 'Outro@12345'
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'DUPLICATE_EMAIL');
});

test('admin: senha curta e recusada', async () => {
  const r = await admin.post('/api/users', {
    name: 'Fraco', email: 'fraco@teste.local', role: 'operator', password: '123'
  });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.password);
});

test('admin: o sistema nao pode ficar sem administrador', async () => {
  const lista = await admin.get('/api/users?pageSize=100');
  const unicoAdmin = lista.body.data.find((u) => u.role === 'admin' && u.status === 'active');

  const rebaixar = await admin.put(`/api/users/${unicoAdmin.id}`, {
    name: unicoAdmin.name, email: unicoAdmin.email, role: 'operator', status: 'active'
  });
  assert.equal(rebaixar.status, 409);
  assert.equal(rebaixar.body.error, 'LAST_ADMIN');
});

test('admin: nao desativa a propria conta', async () => {
  const lista = await admin.get('/api/users?pageSize=100');
  const eu = lista.body.data.find((u) => u.email === 'admin@sistema.local');

  const r = await admin.patch(`/api/users/${eu.id}/status`, { status: 'inactive' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'SELF_DEACTIVATION');
});

test('as operacoes de usuario ficam registradas na auditoria', async () => {
  const r = await admin.get('/api/audit-logs?entity=user&pageSize=50&period=all');
  const acoes = r.body.data.map((a) => a.action);

  assert.ok(acoes.includes('create'), 'criacao de usuario auditada');
  assert.ok(acoes.includes('update'), 'edicao de usuario auditada');
  assert.ok(acoes.includes('status_change'), 'ativacao/desativacao auditada');
});

// ====================================================================
// EXCLUSAO: quem pode apagar, e o que acontece com o historico
// ====================================================================
// O botao de apagar existe so para o administrador. Mas permissao nao e a
// unica barreira: historico financeiro nunca some por acidente, e as coletas
// de um usuario nunca somem junto com a conta dele.
// ====================================================================

test('apagar: a permissao pertence somente ao administrador', () => {
  for (const permissao of ['owners.delete', 'machines.delete', 'users.delete']) {
    assert.equal(pode('admin', permissao), true, `admin precisa de ${permissao}`);
    assert.equal(pode('operator', permissao), false, `operador nao pode ${permissao}`);
  }
});

test('operador: nao apaga cliente, maquina nem usuario', async () => {
  assert.equal((await operador.del(`/api/owners/${ownerId}`)).status, 403);
  assert.equal((await operador.del(`/api/machines/${machineId}`)).status, 403);
  assert.equal((await operador.del('/api/users/1')).status, 403);

  // E nem com cascade na query, que e o caminho destrutivo.
  assert.equal((await operador.del(`/api/owners/${ownerId}?cascade=1`)).status, 403);

  // O registro continua la.
  assert.equal((await admin.get(`/api/owners/${ownerId}`)).status, 200);
});

test('apagar: registro sem historico sai direto', async () => {
  const novo = await admin.upload('/api/owners', h.ownerForm({ name: 'Cliente Efemero', document: '39053344705' }));
  const id = novo.body.data.id;

  const r = await admin.del(`/api/owners/${id}`);
  assert.equal(r.status, 200);
  assert.equal((await admin.get(`/api/owners/${id}`)).status, 404);
});

test('apagar: maquina sem coletas sai direto', async () => {
  const dono = await admin.upload('/api/owners', h.ownerForm({ name: 'Dono da Vazia', document: '15350946056' }));
  const maquina = await admin.post('/api/machines', {
    number: 'DEL-01', name: 'Maquina Sem Coleta', owner_id: dono.body.data.id
  });

  const r = await admin.del(`/api/machines/${maquina.body.data.id}`);
  assert.equal(r.status, 200);
  assert.equal((await admin.get(`/api/machines/${maquina.body.data.id}`)).status, 404);

  await admin.del(`/api/owners/${dono.body.data.id}`);
});

test('apagar: com historico, o backend barra e devolve o resumo', async () => {
  const r = await admin.del(`/api/owners/${ownerId}`);

  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'HAS_HISTORY');
  assert.ok(r.body.details, 'a interface precisa do resumo para oferecer as duas saidas');
  assert.equal(r.body.details.tipo, 'owner');
  assert.ok(r.body.details.maquinas >= 1);
  assert.ok(r.body.details.coletas >= 1);
  assert.ok(r.body.details.fotos >= 1);

  // Nada foi tocado.
  assert.equal((await admin.get(`/api/owners/${ownerId}`)).status, 200);
  assert.equal((await admin.get(`/api/machines/${machineId}`)).status, 200);
});

test('apagar: usuario com coletas nunca e apagado - so desativado', async () => {
  const lista = await admin.get('/api/users?pageSize=50');
  const operadorUser = lista.body.data.find((u) => u.email === 'operador@teste.local');

  const r = await admin.del(`/api/users/${operadorUser.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'USER_HAS_COLLECTIONS');
  assert.ok(r.body.details.coletas >= 1);

  // A conta continua existindo, com as coletas intactas.
  const depois = await admin.get('/api/users?pageSize=50');
  assert.ok(depois.body.data.some((u) => u.email === 'operador@teste.local'));

  const coleta = await admin.get(`/api/collections/${coletaDoOperador}`);
  assert.equal(coleta.status, 200);
});

test('apagar: usuario sem coletas sai, e a propria conta nunca', async () => {
  const criado = await admin.post('/api/users', {
    name: 'Usuario Descartavel', email: 'descartavel@teste.local',
    role: 'operator', password: 'Descarta@123'
  });
  assert.equal(criado.status, 201);

  assert.equal((await admin.del(`/api/users/${criado.body.data.id}`)).status, 200);

  const lista = await admin.get('/api/users?pageSize=50');
  assert.equal(lista.body.data.some((u) => u.email === 'descartavel@teste.local'), false);

  const eu = lista.body.data.find((u) => u.email === 'admin@sistema.local');
  const proprio = await admin.del(`/api/users/${eu.id}`);
  assert.equal(proprio.status, 400);
  assert.equal(proprio.body.error, 'SELF_DELETION');
});

test('apagar: o cascade destroi coletas, fotos e arquivos do disco', async () => {
  const antes = h.countUploads();
  assert.ok(antes > 0, 'o cenario precisa de fotos no disco');

  const r = await admin.del(`/api/owners/${ownerId}?cascade=1`);
  assert.equal(r.status, 200);

  assert.equal((await admin.get(`/api/owners/${ownerId}`)).status, 404);
  assert.equal((await admin.get(`/api/machines/${machineId}`)).status, 404);
  assert.equal((await admin.get(`/api/collections/${coletaDoOperador}`)).status, 404);
  assert.equal((await admin.get(`/api/collections/${coletaDoAdmin}`)).status, 404);

  // Os arquivos saem do disco junto: guardar foto de coleta que nao existe
  // mais e so ocupar espaco.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(h.countUploads() < antes, 'as fotos deveriam ter saido do disco');

  // O relatorio nao devolve mais nada daquele cliente.
  const relatorio = await admin.get('/api/reports/period?period=all');
  assert.equal(relatorio.body.data.rows.some((linha) => linha.owner_id === ownerId), false);
});

test('apagar: a destruicao fica registrada na auditoria com o que foi perdido', async () => {
  const r = await admin.get('/api/audit-logs?entity=owner&pageSize=50');
  const registro = r.body.data.find((a) => a.action === 'delete' && a.entity_id === ownerId);

  assert.ok(registro, 'exclusao de cliente auditada');
  assert.ok(registro.old_values.coletas_removidas >= 1, 'a auditoria guarda o que foi destruido');
  assert.ok(registro.reason, 'a exclusao com historico registra que foi confirmada');
});
