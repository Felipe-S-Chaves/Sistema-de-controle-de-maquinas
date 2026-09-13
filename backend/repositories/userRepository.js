'use strict';

const db = require('../config/database');

const PUBLIC_FIELDS = 'id, name, email, role, status, last_login_at, created_at, updated_at';

async function findByEmail(email) {
  return db.queryOne(
    `SELECT id, name, email, password_hash, role, status FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
}

async function findById(id) {
  return db.queryOne(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ? LIMIT 1`, [id]);
}

async function touchLastLogin(id) {
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id]);
}

async function updatePassword(id, passwordHash) {
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

async function findPasswordHash(id) {
  return db.queryOne('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [id]);
}

module.exports = { findByEmail, findById, touchLastLogin, updatePassword, findPasswordHash };
