'use strict';

const db = require('../config/database');

/**
 * Contas do sistema.
 *
 * A conta e a fronteira de isolamento: cada uma enxerga apenas os proprios
 * clientes, maquinas, coletas, usuarios e auditoria. Este repositorio e o
 * unico lugar que olha para a tabela inteira, e o que ele expoe para fora e
 * so o nome - o suficiente para a pessoa escolher onde pedir acesso.
 */

async function findById(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  return db.queryOne('SELECT id, name, status FROM accounts WHERE id = ? LIMIT 1', [numero]);
}

async function findByName(name) {
  return db.queryOne('SELECT id, name, status FROM accounts WHERE name = ? LIMIT 1', [name]);
}

/** Contas ativas, para a lista de escolha no cadastro. Apenas id e nome. */
async function listActive() {
  return db.query(
    "SELECT id, name FROM accounts WHERE status = 'active' ORDER BY name ASC"
  );
}

async function create({ name, status = 'active' }) {
  const resultado = await db.query(
    'INSERT INTO accounts (name, status) VALUES (?, ?)', [name, status]
  );
  return resultado.insertId;
}

/** Garante que a conta exista com este nome, sem duplicar. */
async function ensure(name) {
  const existente = await findByName(name);
  if (existente) return existente.id;
  return create({ name });
}

module.exports = { findById, findByName, listActive, create, ensure };
