'use strict';

const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  timezone: config.db.timezone,
  decimalNumbers: false,
  namedPlaceholders: false,
  charset: 'utf8mb4_unicode_ci',
  dateStrings: ['DATE']
});

/**
 * Executa uma query parametrizada. NUNCA concatenar valores em SQL.
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Retorna a primeira linha ou null. */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * Executa um callback dentro de uma transacao.
 * O callback recebe a conexao e deve usar conn.execute().
 */
async function transaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* noop */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function healthCheck() {
  const row = await queryOne('SELECT 1 AS ok');
  return Boolean(row && row.ok === 1);
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, queryOne, transaction, healthCheck, close };
