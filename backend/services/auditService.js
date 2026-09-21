'use strict';

const db = require('../config/database');
const { exigirConta } = require('../utils/tenant');

/**
 * Registra uma operacao relevante na trilha de auditoria.
 * Nunca lanca erro para o fluxo principal: uma falha de auditoria
 * e logada, mas nao impede a operacao ja validada.
 * Aceita uma conexao de transacao (conn) para gravar atomicamente.
 *
 * accountId nulo e reservado a eventos que acontecem FORA de qualquer conta:
 * login que falhou, cadastro com e-mail repetido, conversoes do banco. Tudo
 * que nasce dentro de uma conta precisa informa-la, senao some da auditoria
 * de quem deveria ver.
 */
async function log({
  conn = null, accountId = null, userId = null, entity, entityId = null, action,
  oldValues = null, newValues = null, reason = null, req = null
}) {
  const sql = `INSERT INTO audit_logs
    (account_id, user_id, entity, entity_id, action, old_values, new_values, reason, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const params = [
    accountId === null || accountId === undefined ? null : Number(accountId),
    userId,
    entity,
    entityId,
    action,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    reason,
    req ? (req.ip || null) : null,
    req ? String(req.headers['user-agent'] || '').slice(0, 255) : null
  ];

  try {
    if (conn) {
      await conn.execute(sql, params);
    } else {
      await db.query(sql, params);
    }
  } catch (error) {
    console.error('[audit] Falha ao registrar log:', error.message);
  }
}

/** Listagem paginada da auditoria. */
async function list({ accountId, page = 1, pageSize = 20, entity = null, entityId = null, userId = null, from = null, to = null }) {
  const where = ['a.account_id = ?'];
  const params = [exigirConta(accountId)];

  if (entity) { where.push('a.entity = ?'); params.push(entity); }
  if (entityId) { where.push('a.entity_id = ?'); params.push(Number(entityId)); }
  if (userId) { where.push('a.user_id = ?'); params.push(Number(userId)); }
  if (from) { where.push('a.created_at >= ?'); params.push(from); }
  if (to) { where.push('a.created_at <= ?'); params.push(to); }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const offset = (page - 1) * pageSize;

  const rows = await db.query(
    `SELECT a.id, a.entity, a.entity_id, a.action, a.old_values, a.new_values,
            a.reason, a.ip_address, a.created_at, a.user_id, u.name AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String(offset)]
  );

  const totalRow = await db.queryOne(
    `SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, params
  );

  return { items: rows.map(parseRow), total: Number(totalRow.total) };
}

function parseRow(row) {
  const safeParse = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return null; }
  };
  return { ...row, old_values: safeParse(row.old_values), new_values: safeParse(row.new_values) };
}

module.exports = { log, list };
