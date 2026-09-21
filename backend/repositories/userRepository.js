'use strict';

const db = require('../config/database');
const { exigirConta } = require('../utils/tenant');

const PUBLIC_FIELDS = `id, account_id, name, email, role, status,
  must_change_password, last_login_at, created_at, updated_at`;

/**
 * Busca pelo e-mail para o login.
 *
 * Esta e a UNICA consulta de usuario que nao filtra por conta, e de proposito:
 * no momento do login ainda nao se sabe a conta - ela vem justamente daqui.
 * O e-mail e unico no sistema todo, entao a resposta e sempre uma pessoa so.
 */
async function findByEmail(email) {
  return db.queryOne(
    `SELECT id, account_id, name, email, password_hash, role, status, must_change_password
       FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
}

async function findById(id, accountId) {
  return db.queryOne(
    `SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ? AND account_id = ? LIMIT 1`,
    [id, exigirConta(accountId)]
  );
}

async function touchLastLogin(id) {
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id]);
}

/** Troca a senha e derruba a exigencia de troca obrigatoria. */
async function updatePassword(id, passwordHash) {
  await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [passwordHash, id]
  );
}

async function findPasswordHash(id) {
  return db.queryOne('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [id]);
}

/** Cria um usuario dentro de uma conta. */
async function create({ accountId, name, email, passwordHash, role, status, mustChangePassword = false }) {
  return db.query(
    `INSERT INTO users (account_id, name, email, password_hash, role, status, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [exigirConta(accountId), name, email, passwordHash, role, status, mustChangePassword ? 1 : 0]
  );
}

/** Quantas contas aguardam liberacao do administrador NESTA conta. */
async function countPending(accountId) {
  const row = await db.queryOne(
    "SELECT COUNT(*) AS total FROM users WHERE account_id = ? AND status = 'inactive'",
    [exigirConta(accountId)]
  );
  return Number(row.total || 0);
}

module.exports = {
  findByEmail, findById, touchLastLogin, updatePassword, findPasswordHash,
  create, countPending
};
