'use strict';

const db = require('../config/database');

const BASE_SELECT = `
  SELECT m.id, m.number, m.name, m.owner_id, m.model, m.manufacturer, m.serial_number,
         m.installation_date, m.status, m.notes, m.created_at, m.updated_at,
         o.name AS owner_name, o.document AS owner_document
    FROM machines m
    JOIN owners o ON o.id = m.owner_id`;

async function list({ page = 1, pageSize = 20, search = null, status = null, ownerId = null, orderBy = 'number', orderDir = 'ASC' }) {
  const where = [];
  const params = [];

  if (search) {
    where.push('(m.number LIKE ? OR m.name LIKE ? OR o.name LIKE ? OR m.serial_number LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (status) { where.push('m.status = ?'); params.push(status); }
  if (ownerId) { where.push('m.owner_id = ?'); params.push(Number(ownerId)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeOrderBy = ['number', 'name', 'created_at', 'status'].includes(orderBy) ? orderBy : 'number';
  const safeOrderDir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const offset = (page - 1) * pageSize;

  const items = await db.query(
    `${BASE_SELECT}
     ${whereSql}
     ORDER BY m.${safeOrderBy} ${safeOrderDir}
     LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String(offset)]
  );

  const totalRow = await db.queryOne(
    `SELECT COUNT(*) AS total FROM machines m JOIN owners o ON o.id = m.owner_id ${whereSql}`,
    params
  );

  return { items, total: Number(totalRow.total) };
}

async function findById(id) {
  return db.queryOne(`${BASE_SELECT} WHERE m.id = ? LIMIT 1`, [id]);
}

async function findByNumber(number, excludeId = null) {
  const params = [number];
  let sql = 'SELECT id, name FROM machines WHERE number = ?';
  if (excludeId) { sql += ' AND id <> ?'; params.push(excludeId); }
  return db.queryOne(`${sql} LIMIT 1`, params);
}

async function listByOwner(ownerId) {
  return db.query(
    `SELECT m.id, m.number, m.name, m.status, m.installation_date,
            (SELECT c.collected_at FROM collections c
              WHERE c.machine_id = m.id AND c.status = 'confirmed'
              ORDER BY c.collected_at DESC, c.id DESC LIMIT 1) AS last_collection_at,
            (SELECT c.calculated_total_value FROM collections c
              WHERE c.machine_id = m.id AND c.status = 'confirmed'
              ORDER BY c.collected_at DESC, c.id DESC LIMIT 1) AS last_total_value
       FROM machines m
      WHERE m.owner_id = ?
      ORDER BY m.number ASC`,
    [ownerId]
  );
}

async function create(data) {
  const result = await db.query(
    `INSERT INTO machines
       (number, name, owner_id, model, manufacturer, serial_number, installation_date, status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.number, data.name, data.owner_id, data.model, data.manufacturer, data.serial_number,
      data.installation_date, data.status, data.notes, data.created_by]
  );
  return result.insertId;
}

async function update(id, data) {
  await db.query(
    `UPDATE machines SET
       number = ?, name = ?, owner_id = ?, model = ?, manufacturer = ?, serial_number = ?,
       installation_date = ?, status = ?, notes = ?
     WHERE id = ?`,
    [data.number, data.name, data.owner_id, data.model, data.manufacturer, data.serial_number,
      data.installation_date, data.status, data.notes, id]
  );
}

/** Resumo da maquina: ultima coleta + totais do mes e do periodo. */
async function summary(machineId, { from = null, to = null } = {}) {
  const last = await db.queryOne(
    `SELECT id, collected_at, previous_entry_value, current_entry_value, calculated_entry_value,
            previous_exit_value, current_exit_value, calculated_exit_value, calculated_total_value
       FROM collections
      WHERE machine_id = ? AND status = 'confirmed'
      ORDER BY collected_at DESC, id DESC LIMIT 1`,
    [machineId]
  );

  const monthTotals = await db.queryOne(
    `SELECT COUNT(*) AS collections_count,
            COALESCE(SUM(calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(calculated_total_value), 0) AS total_value
       FROM collections
      WHERE machine_id = ? AND status = 'confirmed'
        AND YEAR(collected_at) = YEAR(CURDATE()) AND MONTH(collected_at) = MONTH(CURDATE())`,
    [machineId]
  );

  const periodParams = [machineId];
  let periodSql = "WHERE machine_id = ? AND status = 'confirmed'";
  if (from) { periodSql += ' AND collected_at >= ?'; periodParams.push(from); }
  if (to) { periodSql += ' AND collected_at <= ?'; periodParams.push(to); }

  const periodTotals = await db.queryOne(
    `SELECT COUNT(*) AS collections_count,
            COALESCE(SUM(calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(calculated_total_value), 0) AS total_value
       FROM collections ${periodSql}`,
    periodParams
  );

  return { last_collection: last || null, month: monthTotals, period: periodTotals };
}

/** Busca leve por numero/nome (busca global e autocomplete). */
async function searchLight(term, limit = 20, ownerId = null) {
  const like = `%${term}%`;
  const params = [like, like];
  let ownerSql = '';
  if (ownerId) { ownerSql = 'AND m.owner_id = ?'; params.push(Number(ownerId)); }
  params.push(String(limit));

  return db.query(
    `SELECT m.id, m.number, m.name, m.status, m.owner_id, o.name AS owner_name
       FROM machines m
       JOIN owners o ON o.id = m.owner_id
      WHERE (m.number LIKE ? OR m.name LIKE ?) ${ownerSql}
      ORDER BY m.number ASC LIMIT ?`,
    params
  );
}

module.exports = { list, findById, findByNumber, listByOwner, create, update, summary, searchLight };
