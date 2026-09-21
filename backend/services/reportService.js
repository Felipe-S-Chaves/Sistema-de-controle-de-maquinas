'use strict';

const db = require('../config/database');
const AppError = require('../utils/AppError');
const ownerRepository = require('../repositories/ownerRepository');
const money = require('../utils/money');
const { exigirConta } = require('../utils/tenant');

/**
 * REGRA DE SOMATORIO:
 * totais consideram SOMENTE coletas confirmadas; canceladas ficam
 * no historico mas nunca entram nos totais.
 *
 *   Total entrada apurada = SUM(calculated_entry_value)
 *   Total saida apurada   = SUM(calculated_exit_value)
 *   Total bruto           = total entrada apurada - total saida apurada
 *   Valor para cada       = total bruto / 2
 *
 * A divisao ao meio existe SO no relatorio. Ela nao muda nada do que foi
 * gravado na coleta: o valor bruto continua sendo calculado e guardado
 * exatamente como sempre foi (ver collectionCalculator.js).
 *
 * A soma e feita coleta a coleta (nunca "ultimo relogio - primeiro relogio"),
 * para que coletas intermediarias e cancelamentos sejam respeitados.
 *
 * "Valor bruto" e o nome que o relatorio da ao valor apurado de cada coleta
 * (calculated_total_value). O calculo nao mudou - so o rotulo.
 */

const LIMITE_LINHAS = 5000;
const LIMITE_MAQUINAS = 300;

/** Monta o WHERE comum entre as linhas e os totais. */
function filtros({ accountId, ownerId, machineIds, from, to, userId }) {
  const where = ["c.status = 'confirmed'", 'c.account_id = ?'];
  const params = [exigirConta(accountId)];

  if (userId) { where.push('c.user_id = ?'); params.push(Number(userId)); }
  if (ownerId) { where.push('c.owner_id = ?'); params.push(Number(ownerId)); }

  if (machineIds && machineIds.length) {
    where.push(`c.machine_id IN (${machineIds.map(() => '?').join(', ')})`);
    params.push(...machineIds.map(Number));
  }

  if (from) { where.push('c.collected_at >= ?'); params.push(from); }
  if (to) { where.push('c.collected_at <= ?'); params.push(to); }

  return { whereSql: where.join(' AND '), params };
}

/**
 * Coleta a coleta, na ordem em que aconteceram.
 *
 * As leituras anteriores (previous_*) sao gravadas na propria coleta, entao a
 * "ultima entrada" e a "ultima saida" que o relatorio mostra sao exatamente os
 * numeros usados no calculo daquela linha - nao uma reconstrucao posterior.
 */
async function fetchCollections(criterio) {
  const { whereSql, params } = filtros(criterio);

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
      WHERE ${whereSql}
      ORDER BY c.collected_at ASC, c.id ASC
      LIMIT ?`,
    [...params, String(LIMITE_LINHAS)]
  );
}

async function fetchTotals(criterio) {
  const { whereSql, params } = filtros(criterio);

  const linha = await db.queryOne(
    `SELECT COUNT(*) AS collections_count,
            COALESCE(SUM(c.calculated_entry_value), 0) AS total_entry,
            COALESCE(SUM(c.calculated_exit_value), 0) AS total_exit,
            COALESCE(SUM(c.calculated_total_value), 0) AS total_value
       FROM collections c WHERE ${whereSql}`,
    params
  );

  return normalizeTotals(linha);
}

function normalizeTotals(totals) {
  const totalValue = Number(totals.total_value || 0).toFixed(2);

  return {
    collections_count: Number(totals.collections_count || 0),
    total_entry: Number(totals.total_entry || 0).toFixed(2),
    total_exit: Number(totals.total_exit || 0).toFixed(2),
    total_value: totalValue,

    // Metade do total, para o acerto entre as duas partes. Sai da divisao do
    // TOTAL, nao da soma das metades de cada linha - em valores com centavos
    // impares as duas contas podem diferir um centavo, e quem manda no acerto
    // e o total.
    total_value_half: money.half(totalValue)
  };
}

/**
 * Normaliza a selecao de maquinas vinda da query.
 * Aceita machine_ids=1,2,3 (selecao por clique) e tambem machine_id=1,
 * que continua atendendo os links diretos de outras telas.
 */
function parseMachineIds(raw, single) {
  const bruto = []
    .concat(raw === undefined || raw === null ? [] : raw)
    .concat(single === undefined || single === null ? [] : single);

  const ids = [];
  for (const parte of bruto) {
    for (const pedaco of String(parte).split(',')) {
      const id = parseInt(pedaco, 10);
      if (id > 0 && ids.indexOf(id) === -1) ids.push(id);
    }
  }

  if (ids.length > LIMITE_MAQUINAS) {
    throw AppError.validation('Selecao de maquinas muito grande.', {
      machine_ids: `Selecione no maximo ${LIMITE_MAQUINAS} maquinas por relatorio.`
    });
  }
  return ids;
}

/** Dados das maquinas escolhidas, para o cabecalho do relatorio e do PDF. */
async function fetchMachines(machineIds, accountId) {
  if (!machineIds.length) return [];
  return db.query(
    `SELECT m.id, m.number, m.name, m.owner_id, o.name AS owner_name
       FROM machines m
       JOIN owners o ON o.id = m.owner_id
      WHERE m.account_id = ? AND m.id IN (${machineIds.map(() => '?').join(', ')})
      ORDER BY m.number ASC`,
    [exigirConta(accountId), ...machineIds.map(Number)]
  );
}

/**
 * Monta o contexto usado tanto pelo JSON quanto pelo PDF.
 *
 * O relatorio e sempre analitico: uma linha por coleta confirmada. O recorte
 * vem do cliente e das maquinas selecionadas por clique na tela.
 */
async function buildReport({ ownerId, machineIds = [], period, accountId }) {
  const conta = exigirConta(accountId);

  const context = {
    type: 'period',
    period_label: period.label,
    from: period.from,
    to: period.to,
    owner: null,
    machines: [],
    machine: null
  };

  if (ownerId) {
    const owner = await ownerRepository.findById(ownerId, conta);
    if (!owner) throw AppError.notFound('Cliente nao encontrado.');
    context.owner = {
      id: owner.id, name: owner.name, document: owner.document, document_type: owner.document_type
    };
  }

  if (machineIds.length) {
    context.machines = await fetchMachines(machineIds, conta);
    if (!context.machines.length) throw AppError.notFound('Maquina nao encontrada.');

    // Uma unica maquina: o cabecalho fica mais direto nomeando-a.
    if (context.machines.length === 1) {
      const m = context.machines[0];
      context.machine = { id: m.id, number: m.number, name: m.name, owner_name: m.owner_name };
      if (!context.owner) context.owner = { id: m.owner_id, name: m.owner_name, document: null };
    }
  }

  const criterio = { accountId: conta, ownerId, machineIds, from: period.from, to: period.to };
  const rows = await fetchCollections(criterio);
  const totals = await fetchTotals(criterio);

  return { ...context, rows, totals };
}

/**
 * Relatorio das coletas de UM usuario.
 *
 * O userId vem sempre do token de quem pediu, nunca da query: por construcao,
 * ninguem consegue montar o relatorio do trabalho de outra pessoa por aqui.
 */
async function buildOwnReport({ userId, period, userName, accountId }) {
  const criterio = {
    accountId: exigirConta(accountId), userId, from: period.from, to: period.to, machineIds: []
  };

  const rows = await fetchCollections(criterio);
  const totals = await fetchTotals(criterio);

  return {
    type: 'period',
    scope: 'own',
    period_label: period.label,
    from: period.from,
    to: period.to,
    owner: null,
    machines: [],
    machine: null,
    operator: userName || null,
    rows,
    totals
  };
}

module.exports = { buildReport, buildOwnReport, fetchCollections, fetchTotals, parseMachineIds };
