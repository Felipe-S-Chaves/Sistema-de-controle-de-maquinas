'use strict';

/**
 * Gerenciamento de usuarios - exclusivo do administrador.
 */

const bcrypt = require('bcryptjs');

const db = require('../config/database');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const { Validator } = require('../validations/validator');
const { PAPEIS } = require('../config/permissions');
const { exigirConta } = require('../utils/tenant');

const CAMPOS = `id, account_id, name, email, role, status, must_change_password,
  last_login_at, created_at, updated_at`;
const PAPEIS_VALIDOS = Object.keys(PAPEIS);

async function list({ accountId, page = 1, pageSize = 20, search = null }) {
  const where = ['account_id = ?'];
  const params = [exigirConta(accountId)];

  if (search) {
    where.push('(name LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const items = await db.query(
    `SELECT ${CAMPOS},
            (SELECT COUNT(*) FROM collections c WHERE c.user_id = users.id) AS collections_count
       FROM users ${whereSql}
      ORDER BY name ASC
      LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String(offset)]
  );

  const total = await db.queryOne(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
  return { items, total: Number(total.total), page, pageSize };
}

function validar(body, { exigirSenha }) {
  const v = new Validator(body)
    .string('name', { label: 'Nome', required: true, min: 3, max: 150 })
    .email('email', { label: 'E-mail', required: true })
    .enum('role', PAPEIS_VALIDOS, { label: 'Perfil', required: true })
    .enum('status', ['active', 'inactive'], { label: 'Status', defaultValue: 'active' });

  const senha = typeof body.password === 'string' ? body.password : '';
  if (exigirSenha || senha) {
    if (senha.length < 8) v.fail('password', 'A senha deve ter no minimo 8 caracteres.');
    else v.values.password = senha;
  }

  return v.validate();
}

/**
 * E-mail duplicado e checado no sistema INTEIRO, nao dentro da conta: ele e a
 * identidade de login, e duas pessoas em contas diferentes nao podem disputar
 * o mesmo endereco. A mensagem, porem, nao revela nada sobre a outra conta.
 */
async function findByEmail(email, excluirId = null) {
  const params = [email];
  let sql = 'SELECT id, name FROM users WHERE email = ?';
  if (excluirId) { sql += ' AND id <> ?'; params.push(excluirId); }
  return db.queryOne(`${sql} LIMIT 1`, params);
}

async function create({ body, user, req }) {
  const dados = validar(body, { exigirSenha: true });

  const duplicado = await findByEmail(dados.email);
  if (duplicado) {
    throw AppError.conflict(
      'Este e-mail ja esta em uso.',
      'DUPLICATE_EMAIL',
      { email: 'E-mail ja cadastrado.' }
    );
  }

  const conta = exigirConta(user.account_id);
  const hash = await bcrypt.hash(dados.password, config.bcryptRounds);
  const resultado = await db.query(
    `INSERT INTO users (account_id, name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conta, dados.name, dados.email, hash, dados.role, dados.status]
  );

  await auditService.log({
    accountId: conta,
    userId: user.id,
    entity: 'user',
    entityId: resultado.insertId,
    action: 'create',
    newValues: { name: dados.name, email: dados.email, role: dados.role, status: dados.status },
    req
  });

  return buscar(resultado.insertId, conta);
}

/** Um usuario DESTA conta. Fora dela, e como se nao existisse. */
async function buscar(id, accountId) {
  return db.queryOne(
    `SELECT ${CAMPOS} FROM users WHERE id = ? AND account_id = ?`,
    [id, exigirConta(accountId)]
  );
}

async function update({ id, body, user, req }) {
  const conta = exigirConta(user.account_id);
  const atual = await buscar(id, conta);
  if (!atual) throw AppError.notFound('Usuario nao encontrado.');

  const dados = validar(body, { exigirSenha: false });

  const duplicado = await findByEmail(dados.email, id);
  if (duplicado) {
    throw AppError.conflict(
      'Este e-mail ja esta em uso.',
      'DUPLICATE_EMAIL',
      { email: 'E-mail ja cadastrado.' }
    );
  }

  // Nao deixar a conta ficar sem nenhum administrador ativo.
  if (atual.role === 'admin' && (dados.role !== 'admin' || dados.status !== 'active')) {
    await garantirOutroAdmin(id, conta);
  }

  await db.query(
    'UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ? AND account_id = ?',
    [dados.name, dados.email, dados.role, dados.status, id, conta]
  );

  if (dados.password) {
    const hash = await bcrypt.hash(dados.password, config.bcryptRounds);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }

  await auditService.log({
    accountId: conta,
    userId: user.id,
    entity: 'user',
    entityId: Number(id),
    action: 'update',
    oldValues: { name: atual.name, email: atual.email, role: atual.role, status: atual.status },
    newValues: {
      name: dados.name, email: dados.email, role: dados.role, status: dados.status,
      senha_alterada: Boolean(dados.password)
    },
    req
  });

  return buscar(id, conta);
}

async function setStatus({ id, status, user, req }) {
  const conta = exigirConta(user.account_id);
  const atual = await buscar(id, conta);
  if (!atual) throw AppError.notFound('Usuario nao encontrado.');

  if (!['active', 'inactive'].includes(status)) {
    throw AppError.validation('Status invalido.', { status: 'Use active ou inactive.' });
  }
  if (Number(id) === Number(user.id) && status === 'inactive') {
    throw AppError.badRequest('Voce nao pode desativar a propria conta.', 'SELF_DEACTIVATION');
  }
  if (atual.role === 'admin' && status === 'inactive') {
    await garantirOutroAdmin(id, conta);
  }

  await db.query('UPDATE users SET status = ? WHERE id = ? AND account_id = ?', [status, id, conta]);
  await auditService.log({
    accountId: conta,
    userId: user.id, entity: 'user', entityId: Number(id), action: 'status_change',
    oldValues: { status: atual.status }, newValues: { status }, req
  });

  return buscar(id, conta);
}

async function resetPassword({ id, password, user, req }) {
  const conta = exigirConta(user.account_id);
  const alvo = await db.queryOne(
    'SELECT id, name FROM users WHERE id = ? AND account_id = ?', [id, conta]
  );
  if (!alvo) throw AppError.notFound('Usuario nao encontrado.');

  if (typeof password !== 'string' || password.length < 8) {
    throw AppError.validation('Senha invalida.', { password: 'A senha deve ter no minimo 8 caracteres.' });
  }

  const hash = await bcrypt.hash(password, config.bcryptRounds);
  await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND account_id = ?',
    [hash, id, conta]
  );

  await auditService.log({
    accountId: conta,
    userId: user.id, entity: 'user', entityId: Number(id), action: 'reset_password', req
  });

  return true;
}

/**
 * Impede que a CONTA fique sem administrador ativo.
 * O administrador da outra conta nao serve de substituto: as duas sao
 * independentes e ninguem atravessa de uma para a outra.
 */
async function garantirOutroAdmin(excluirId, accountId) {
  const outro = await db.queryOne(
    `SELECT id FROM users
      WHERE account_id = ? AND role = 'admin' AND status = 'active' AND id <> ? LIMIT 1`,
    [exigirConta(accountId), excluirId]
  );
  if (!outro) {
    throw AppError.conflict(
      'Este e o unico administrador ativo desta conta. Promova outro usuario antes de alterar este.',
      'LAST_ADMIN'
    );
  }
}

module.exports = { list, create, update, setStatus, resetPassword };
