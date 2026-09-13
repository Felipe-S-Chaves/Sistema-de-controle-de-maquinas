'use strict';

const db = require('../config/database');

const LIST_SELECT = `
  SELECT c.id, c.machine_id, c.owner_id, c.user_id,
         c.previous_entry_value, c.current_entry_value, c.calculated_entry_value,
         c.previous_exit_value, c.current_exit_value, c.calculated_exit_value,
         c.calculated_total_value, c.is_first_collection, c.is_exception,
         c.observation, c.status, c.collected_at, c.cancelled_at, c.cancellation_reason,
         m.number AS machine_number, m.name AS machine_name,
         o.name AS owner_name,
         u.name AS user_name,
         (SELECT COUNT(*) FROM collection_images ci WHERE ci.collection_id = c.id) AS images_count
    FROM collections c
    JOIN machines m ON m.id = c.machine_id
    JOIN owners o   ON o.id = c.owner_id
    JOIN users u    ON u.id = c.user_id`;

function buildFilters({ machineId, ownerId, status, from, to, userId }) {
  const where = [];
  const params = [];
  if (machineId) { where.push('c.machine_id = ?'); params.push(Number(machineId)); }
  if (ownerId) { where.push('c.owner_id = ?'); params.push(Number(ownerId)); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (userId) { where.push('c.user_id = ?'); params.push(Number(userId)); }
  if (from) { where.push('c.collected_at >= ?'); params.push(from); }
  if (to) { where.push('c.collected_at <= ?'); params.push(to); }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function list({ page = 1, pageSize = 20, machineId = null, ownerId = null, status = null,
  from = null, to = null, userId = null, orderDir = 'DESC' }) {
  const { whereSql, params } = buildFilters({ machineId, ownerId, status, from, to, userId });
  const safeOrderDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const items = await db.query(
    `${LIST_SELECT} ${whereSql}
      ORDER BY c.collected_at ${safeOrderDir}, c.id ${safeOrderDir}
      LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String(offset)]
  );

  const totalRow = await db.queryOne(
    `SELECT COUNT(*) AS total FROM collections c ${whereSql}`, params
  );

  return { items, total: Number(totalRow.total) };
}

/** Detalhe completo de uma coleta. */
async function findDetail(id) {
  return db.queryOne(
    `SELECT c.*, m.number AS machine_number, m.name AS machine_name, m.status AS machine_status,
            o.name AS owner_name, o.document AS owner_document, o.document_type AS owner_document_type,
            u.name AS user_name, cu.name AS cancelled_by_name
       FROM collections c
       JOIN machines m ON m.id = c.machine_id
       JOIN owners o   ON o.id = c.owner_id
       JOIN users u    ON u.id = c.user_id
       LEFT JOIN users cu ON cu.id = c.cancelled_by
      WHERE c.id = ? LIMIT 1`,
    [id]
  );
}

/**
 * Ultima coleta CONFIRMADA da maquina - base para a proxima leitura.
 * Coletas canceladas nunca servem de base.
 * Aceita uma conexao de transacao com FOR UPDATE para evitar corrida.
 */
async function findLastConfirmed(machineId, conn = null) {
  const sql = `SELECT id, collected_at, current_entry_value, current_exit_value,
                      calculated_total_value
                 FROM collections
                WHERE machine_id = ? AND status = 'confirmed'
                ORDER BY collected_at DESC, id DESC
                LIMIT 1`;
  if (conn) {
    const [rows] = await conn.execute(`${sql} FOR UPDATE`, [machineId]);
    return rows.length ? rows[0] : null;
  }
  return db.queryOne(sql, [machineId]);
}

/** Insere a coleta dentro de uma transacao. */
async function create(conn, data) {
  const [result] = await conn.execute(
    `INSERT INTO collections
      (machine_id, owner_id, user_id,
       previous_entry_value, current_entry_value, calculated_entry_value,
       previous_exit_value, current_exit_value, calculated_exit_value,
       calculated_total_value, is_first_collection, is_exception, exception_reason,
       observation, status, collected_at, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
    [data.machine_id, data.owner_id, data.user_id,
      data.previous_entry_value, data.current_entry_value, data.calculated_entry_value,
      data.previous_exit_value, data.current_exit_value, data.calculated_exit_value,
      data.calculated_total_value, data.is_first_collection ? 1 : 0,
      data.is_exception ? 1 : 0, data.exception_reason,
      data.observation, data.collected_at, data.timezone]
  );
  return result.insertId;
}

async function addImage(conn, image) {
  const [result] = await conn.execute(
    `INSERT INTO collection_images
       (collection_id, user_id, file_path, original_name, mime_type, size_bytes, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [image.collection_id, image.user_id, image.file_path, image.original_name,
      image.mime_type, image.size_bytes, image.checksum]
  );
  return result.insertId;
}

async function listImages(collectionId) {
  return db.query(
    `SELECT id, collection_id, file_path, original_name, mime_type, size_bytes, created_at
       FROM collection_images WHERE collection_id = ? ORDER BY id ASC`,
    [collectionId]
  );
}

async function findImageById(imageId) {
  return db.queryOne(
    `SELECT ci.*, c.status AS collection_status
       FROM collection_images ci
       JOIN collections c ON c.id = ci.collection_id
      WHERE ci.id = ? LIMIT 1`,
    [imageId]
  );
}

/** Cancela sem apagar fisicamente. */
async function cancel(conn, id, { userId, reason, cancelledAt }) {
  const [result] = await conn.execute(
    `UPDATE collections
        SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancellation_reason = ?
      WHERE id = ? AND status = 'confirmed'`,
    [cancelledAt, userId, reason, id]
  );
  return result.affectedRows;
}

/** Trava a coleta dentro da transacao antes de cancelar. */
async function findForUpdate(conn, id) {
  const [rows] = await conn.execute('SELECT * FROM collections WHERE id = ? FOR UPDATE', [id]);
  return rows.length ? rows[0] : null;
}

/** Existe coleta confirmada posterior a esta na mesma maquina? */
async function hasLaterConfirmed(conn, collection) {
  const [rows] = await conn.execute(
    `SELECT id FROM collections
      WHERE machine_id = ? AND status = 'confirmed'
        AND (collected_at > ? OR (collected_at = ? AND id > ?))
      LIMIT 1`,
    [collection.machine_id, collection.collected_at, collection.collected_at, collection.id]
  );
  return rows.length > 0;
}

/** Totais consolidados de um conjunto de coletas confirmadas. */
async function totals({ machineId = null, ownerId = null, from = null, to = null }) {
  const { whereSql, params } = buildFilters({ machineId, ownerId, status: 'confirmed', from, to });
  return db.queryOne(
    `SELECT COUNT(*) AS collections_count,
            COALESCE(SUM(c.calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(c.calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(c.calculated_total_value), 0) AS total_value
       FROM collections c ${whereSql}`,
    params
  );
}

/** Serie mensal para o grafico do dashboard. */
async function monthlySeries(months = 6) {
  return db.query(
    `SELECT DATE_FORMAT(c.collected_at, '%Y-%m') AS period,
            COUNT(*) AS collections_count,
            COALESCE(SUM(c.calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(c.calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(c.calculated_total_value), 0) AS total_value
       FROM collections c
      WHERE c.status = 'confirmed'
        AND c.collected_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
      GROUP BY period
      ORDER BY period ASC`,
    [String(months - 1)]
  );
}

module.exports = {
  list, findDetail, findLastConfirmed, create, addImage, listImages, findImageById,
  cancel, findForUpdate, hasLaterConfirmed, totals, monthlySeries
};
