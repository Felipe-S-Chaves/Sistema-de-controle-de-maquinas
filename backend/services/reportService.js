'use strict';

const db = require('../config/database');
const AppError = require('../utils/AppError');
const ownerRepository = require('../repositories/ownerRepository');
const machineRepository = require('../repositories/machineRepository');
const collectionRepository = require('../repositories/collectionRepository');

/**
 * REGRA DE SOMATORIO:
 * totais consideram SOMENTE coletas confirmadas; canceladas ficam
 * no historico mas nunca entram nos totais.
 *
 *   Total entrada apurada = SUM(calculated_entry_value)
 *   Total saida apurada   = SUM(calculated_exit_value)
 *   Total apurado         = total entrada apurada - total saida apurada
 *
 * A soma e feita coleta a coleta (nunca "ultimo relogio - primeiro relogio"),
 * para que coletas intermediarias e cancelamentos sejam respeitados.
 */

async function fetchCollections({ ownerId = null, machineId = null, from = null, to = null, limit = 5000 }) {
  const where = ["c.status = 'confirmed'"];
  const params = [];
  if (ownerId) { where.push('c.owner_id = ?'); params.push(Number(ownerId)); }
  if (machineId) { where.push('c.machine_id = ?'); params.push(Number(machineId)); }
  if (from) { where.push('c.collected_at >= ?'); params.push(from); }
  if (to) { where.push('c.collected_at <= ?'); params.push(to); }

  return db.query(
    `SELECT c.id, c.collected_at,
            c.previous_entry_value, c.current_entry_value, c.calculated_entry_value,
            c.previous_exit_value, c.current_exit_value, c.calculated_exit_value,
            c.calculated_total_value, c.is_exception,
            m.number AS machine_number, m.name AS machine_name, m.id AS machine_id,
            o.name AS owner_name, o.id AS owner_id,
            u.name AS user_name
       FROM collections c
       JOIN machines m ON m.id = c.machine_id
       JOIN owners o   ON o.id = c.owner_id
       JOIN users u    ON u.id = c.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.collected_at ASC, c.id ASC
      LIMIT ?`,
    [...params, String(limit)]
  );
}

/** Relatorio consolidado por proprietario. */
async function byOwner({ ownerId, from, to }) {
  const rows = await db.query(
    `SELECT o.id, o.name, o.document, o.document_type,
            COUNT(c.id) AS collections_count,
            COALESCE(SUM(c.calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(c.calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(c.calculated_total_value), 0) AS total_value,
            COUNT(DISTINCT c.machine_id) AS machines_with_collections,
            (SELECT COUNT(*) FROM machines m2 WHERE m2.owner_id = o.id) AS machines_total
       FROM owners o
       LEFT JOIN collections c
         ON c.owner_id = o.id AND c.status = 'confirmed'
        ${from ? 'AND c.collected_at >= ?' : ''}
        ${to ? 'AND c.collected_at <= ?' : ''}
      ${ownerId ? 'WHERE o.id = ?' : ''}
      GROUP BY o.id, o.name, o.document, o.document_type
      ORDER BY total_value DESC, o.name ASC`,
    [...(from ? [from] : []), ...(to ? [to] : []), ...(ownerId ? [Number(ownerId)] : [])]
  );

  return { rows, totals: sumRows(rows) };
}

/** Relatorio consolidado por maquina. */
async function byMachine({ ownerId, machineId, from, to }) {
  const filters = [];
  const joinParams = [];
  if (from) { filters.push('AND c.collected_at >= ?'); joinParams.push(from); }
  if (to) { filters.push('AND c.collected_at <= ?'); joinParams.push(to); }

  const where = [];
  const whereParams = [];
  if (ownerId) { where.push('m.owner_id = ?'); whereParams.push(Number(ownerId)); }
  if (machineId) { where.push('m.id = ?'); whereParams.push(Number(machineId)); }

  const rows = await db.query(
    `SELECT m.id, m.number, m.name, m.status, o.name AS owner_name, o.id AS owner_id,
            COUNT(c.id) AS collections_count,
            COALESCE(SUM(c.calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(c.calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(c.calculated_total_value), 0) AS total_value,
            MAX(c.collected_at) AS last_collection_at
       FROM machines m
       JOIN owners o ON o.id = m.owner_id
       LEFT JOIN collections c
         ON c.machine_id = m.id AND c.status = 'confirmed' ${filters.join(' ')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY m.id, m.number, m.name, m.status, o.name, o.id
      ORDER BY m.number ASC`,
    [...joinParams, ...whereParams]
  );

  return { rows, totals: sumRows(rows) };
}

/** Relatorio analitico por periodo: coleta a coleta. */
async function byPeriod({ ownerId, machineId, from, to }) {
  const rows = await fetchCollections({ ownerId, machineId, from, to });
  const totals = await collectionRepository.totals({ ownerId, machineId, from, to });
  return { rows, totals: normalizeTotals(totals) };
}

function sumRows(rows) {
  let entry = 0;
  let exit = 0;
  let count = 0;
  for (const row of rows) {
    entry += Math.round(Number(row.total_entry) * 100);
    exit += Math.round(Number(row.total_exit) * 100);
    count += Number(row.collections_count || 0);
  }
  return {
    collections_count: count,
    total_entry: (entry / 100).toFixed(2),
    total_exit: (exit / 100).toFixed(2),
    total_value: ((entry - exit) / 100).toFixed(2)
  };
}

function normalizeTotals(totals) {
  return {
    collections_count: Number(totals.collections_count || 0),
    total_entry: Number(totals.total_entry || 0).toFixed(2),
    total_exit: Number(totals.total_exit || 0).toFixed(2),
    total_value: Number(totals.total_value || 0).toFixed(2)
  };
}

/** Monta o contexto usado tanto pelo JSON quanto pelo PDF. */
async function buildReport({ type, ownerId, machineId, period }) {
  const context = {
    type,
    period_label: period.label,
    from: period.from,
    to: period.to,
    owner: null,
    machine: null
  };

  if (ownerId) {
    const owner = await ownerRepository.findById(ownerId);
    if (!owner) throw AppError.notFound('Proprietario nao encontrado.');
    context.owner = { id: owner.id, name: owner.name, document: owner.document, document_type: owner.document_type };
  }

  if (machineId) {
    const machine = await machineRepository.findById(machineId);
    if (!machine) throw AppError.notFound('Maquina nao encontrada.');
    context.machine = { id: machine.id, number: machine.number, name: machine.name, owner_name: machine.owner_name };
    if (!context.owner) {
      context.owner = { id: machine.owner_id, name: machine.owner_name, document: machine.owner_document };
    }
  }

  if (type === 'owners') {
    const { rows, totals } = await byOwner({ ownerId, from: period.from, to: period.to });
    return { ...context, rows, totals };
  }
  if (type === 'machines') {
    const { rows, totals } = await byMachine({ ownerId, machineId, from: period.from, to: period.to });
    return { ...context, rows, totals };
  }

  const { rows, totals } = await byPeriod({ ownerId, machineId, from: period.from, to: period.to });
  return { ...context, rows, totals };
}

module.exports = { buildReport, byOwner, byMachine, byPeriod, fetchCollections };
