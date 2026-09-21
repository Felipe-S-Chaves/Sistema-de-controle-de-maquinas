'use strict';

const db = require('../config/database');
const { exigirConta } = require('../utils/tenant');

const LIST_FIELDS = `o.id, o.name, o.document, o.document_type, o.phone, o.whatsapp,
  o.email, o.city, o.state, o.status, o.created_at, o.updated_at`;

/**
 * Listagem paginada com busca parcial e case-insensitive.
 * A collation utf8mb4_unicode_ci ja torna o LIKE insensivel a maiusculas.
 */
async function list({ accountId, page = 1, pageSize = 20, search = null, status = null, orderBy = 'name', orderDir = 'ASC' }) {
  const where = ['o.account_id = ?'];
  const params = [exigirConta(accountId)];

  if (search) {
    where.push('(o.name LIKE ? OR o.document LIKE ? OR o.email LIKE ? OR o.phone LIKE ?)');
    const like = `%${search}%`;
    const digits = search.replace(/\D/g, '');
    params.push(like, digits ? `%${digits}%` : like, like, digits ? `%${digits}%` : like);
  }
  if (status) { where.push('o.status = ?'); params.push(status); }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const safeOrderBy = ['name', 'created_at', 'updated_at'].includes(orderBy) ? orderBy : 'name';
  const safeOrderDir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const offset = (page - 1) * pageSize;

  const items = await db.query(
    `SELECT ${LIST_FIELDS},
            (SELECT COUNT(*) FROM machines m WHERE m.owner_id = o.id) AS machines_count,
            (SELECT COUNT(*) FROM machines m WHERE m.owner_id = o.id AND m.status = 'active') AS active_machines_count
       FROM owners o
       ${whereSql}
      ORDER BY o.${safeOrderBy} ${safeOrderDir}
      LIMIT ? OFFSET ?`,
    [...params, String(pageSize), String(offset)]
  );

  const totalRow = await db.queryOne(`SELECT COUNT(*) AS total FROM owners o ${whereSql}`, params);
  return { items, total: Number(totalRow.total) };
}

async function findById(id, accountId) {
  return db.queryOne(
    `SELECT o.*, u.name AS created_by_name
       FROM owners o
       LEFT JOIN users u ON u.id = o.created_by
      WHERE o.id = ? AND o.account_id = ? LIMIT 1`,
    [id, exigirConta(accountId)]
  );
}

/** O documento ja existe NESTA conta? Na outra conta nao interessa. */
async function findByDocument(document, accountId, excludeId = null) {
  if (!document) return null;
  const params = [document, exigirConta(accountId)];
  let sql = 'SELECT id, name FROM owners WHERE document = ? AND account_id = ?';
  if (excludeId) { sql += ' AND id <> ?'; params.push(excludeId); }
  return db.queryOne(`${sql} LIMIT 1`, params);
}

async function create(data) {
  const result = await db.query(
    `INSERT INTO owners
      (account_id, name, document, document_type, phone, whatsapp, email,
       address, city, state, zip_code, notes, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [exigirConta(data.account_id), data.name, data.document, data.document_type,
      data.phone, data.whatsapp, data.email,
      data.address, data.city, data.state, data.zip_code, data.notes, data.status, data.created_by]
  );
  return result.insertId;
}

async function update(id, data, accountId) {
  await db.query(
    `UPDATE owners SET
       name = ?, document = ?, document_type = ?, phone = ?, whatsapp = ?, email = ?,
       address = ?, city = ?, state = ?, zip_code = ?, notes = ?, status = ?
     WHERE id = ? AND account_id = ?`,
    [data.name, data.document, data.document_type, data.phone, data.whatsapp, data.email,
      data.address, data.city, data.state, data.zip_code, data.notes, data.status,
      id, exigirConta(accountId)]
  );
}

/** Grava a foto do documento do cliente. */
async function setDocumentPhoto(id, foto, accountId) {
  await db.query(
    `UPDATE owners SET
       document_photo_path = ?, document_photo_name = ?, document_photo_mime = ?,
       document_photo_size = ?, document_photo_checksum = ?, document_photo_at = NOW()
     WHERE id = ? AND account_id = ?`,
    [foto.path, foto.name, foto.mime, foto.size, foto.checksum, id, exigirConta(accountId)]
  );
}

/** Resumo operacional e financeiro do cliente dentro de um periodo. */
async function summary(id, { from = null, to = null, accountId } = {}) {
  const conta = exigirConta(accountId);

  const machines = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(status = 'maintenance') AS maintenance
       FROM machines WHERE owner_id = ? AND account_id = ?`,
    [id, conta]
  );

  const periodParams = [id, conta];
  let periodSql = "WHERE c.owner_id = ? AND c.account_id = ? AND c.status = 'confirmed'";
  if (from) { periodSql += ' AND c.collected_at >= ?'; periodParams.push(from); }
  if (to) { periodSql += ' AND c.collected_at <= ?'; periodParams.push(to); }

  const financial = await db.queryOne(
    `SELECT COUNT(*) AS collections_count,
            COALESCE(SUM(c.calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(c.calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(c.calculated_total_value), 0) AS total_value
       FROM collections c ${periodSql}`,
    periodParams
  );

  const last = await db.queryOne(
    `SELECT c.collected_at, c.calculated_total_value, m.number, m.name
       FROM collections c
       JOIN machines m ON m.id = c.machine_id
      WHERE c.owner_id = ? AND c.account_id = ? AND c.status = 'confirmed'
      ORDER BY c.collected_at DESC, c.id DESC LIMIT 1`,
    [id, conta]
  );

  return {
    machines_total: Number(machines.total || 0),
    machines_active: Number(machines.active || 0),
    machines_maintenance: Number(machines.maintenance || 0),
    collections_count: Number(financial.collections_count || 0),
    total_entry: financial.total_entry,
    total_exit: financial.total_exit,
    total_value: financial.total_value,
    last_collection: last || null
  };
}

/** Busca leve para autocomplete da tela de coleta. */
async function searchLight(term, accountId, limit = 20) {
  const like = `%${term}%`;
  const digits = term.replace(/\D/g, '');
  return db.query(
    `SELECT id, name, document, document_type
       FROM owners
      WHERE account_id = ? AND status = 'active' AND (name LIKE ? OR document LIKE ?)
      ORDER BY name ASC LIMIT ?`,
    [exigirConta(accountId), like, digits ? `%${digits}%` : like, String(limit)]
  );
}

module.exports = {
  list, findById, findByDocument, create, update, setDocumentPhoto, summary, searchLight
};
