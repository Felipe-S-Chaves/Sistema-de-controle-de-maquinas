'use strict';

const db = require('../config/database');
const collectionRepository = require('../repositories/collectionRepository');

/**
 * Metricas do dashboard.
 * Totais financeiros consideram SOMENTE coletas confirmadas.
 */
async function getMetrics(period) {
  const owners = await db.queryOne(
    `SELECT COUNT(*) AS total, SUM(status = 'active') AS active FROM owners`
  );

  const machines = await db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(status = 'maintenance') AS maintenance
       FROM machines`
  );

  const totals = await collectionRepository.totals({ from: period.from, to: period.to });

  const params = [];
  let periodSql = "WHERE c.status = 'confirmed'";
  if (period.from) { periodSql += ' AND c.collected_at >= ?'; params.push(period.from); }
  if (period.to) { periodSql += ' AND c.collected_at <= ?'; params.push(period.to); }

  const cancelled = await db.queryOne(
    `SELECT COUNT(*) AS total FROM collections c
      ${periodSql.replace("c.status = 'confirmed'", "c.status = 'cancelled'")}`,
    params
  );

  return {
    owners_total: Number(owners.total || 0),
    owners_active: Number(owners.active || 0),
    machines_total: Number(machines.total || 0),
    machines_active: Number(machines.active || 0),
    machines_maintenance: Number(machines.maintenance || 0),
    collections_count: Number(totals.collections_count || 0),
    collections_cancelled: Number(cancelled.total || 0),
    total_entry: totals.total_entry,
    total_exit: totals.total_exit,
    total_value: totals.total_value,
    period_label: period.label
  };
}

/** Ultimas coletas para o painel inicial. */
async function getLatestCollections(limit = 8) {
  return db.query(
    `SELECT c.id, c.collected_at, c.current_entry_value, c.current_exit_value,
            c.calculated_entry_value, c.calculated_exit_value, c.calculated_total_value, c.status,
            m.number AS machine_number, m.name AS machine_name,
            o.id AS owner_id, o.name AS owner_name
       FROM collections c
       JOIN machines m ON m.id = c.machine_id
       JOIN owners o   ON o.id = c.owner_id
      ORDER BY c.collected_at DESC, c.id DESC
      LIMIT ?`,
    [String(limit)]
  );
}

async function getMonthlySeries(months = 6) {
  return collectionRepository.monthlySeries(months);
}

/** Busca global: proprietarios + maquinas, com o tipo identificado. */
async function globalSearch(term, limit = 10) {
  const like = `%${term}%`;
  const digits = term.replace(/\D/g, '');

  const owners = await db.query(
    `SELECT id, name, document, document_type, status
       FROM owners
      WHERE name LIKE ? OR document LIKE ?
      ORDER BY name ASC LIMIT ?`,
    [like, digits ? `%${digits}%` : like, String(limit)]
  );

  const machines = await db.query(
    `SELECT m.id, m.number, m.name, m.status, m.owner_id, o.name AS owner_name
       FROM machines m
       JOIN owners o ON o.id = m.owner_id
      WHERE m.number LIKE ? OR m.name LIKE ?
      ORDER BY m.number ASC LIMIT ?`,
    [like, like, String(limit)]
  );

  return {
    owners: owners.map((o) => ({ type: 'owner', ...o })),
    machines: machines.map((m) => ({ type: 'machine', ...m })),
    total: owners.length + machines.length
  };
}

module.exports = { getMetrics, getLatestCollections, getMonthlySeries, globalSearch };
