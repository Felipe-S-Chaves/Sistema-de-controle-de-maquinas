'use strict';

/**
 * Executa o schema.sql no banco configurado.
 * Uso:
 *   node backend/database/migrate.js           -> cria o que faltar
 *   node backend/database/migrate.js --fresh   -> DROPA e recria tudo (destrutivo)
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config/env');
const { recalcular } = require('./recalculate');

const TABLES_IN_DROP_ORDER = [
  'machine_revenue_splits',
  'machine_transfers',
  'audit_logs',
  'collection_images',
  'collections',
  'machines',
  'owners',
  'users',
  'accounts'
];

function splitStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

async function run() {
  const fresh = process.argv.includes('--fresh');

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.changeUser({ database: config.db.database });

  if (fresh) {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_IN_DROP_ORDER) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[migrate] Tabelas anteriores removidas (--fresh).');
  }

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = splitStatements(sql);

  for (const statement of statements) {
    await connection.query(statement);
  }

  await aplicarAjustes(connection);

  console.log(`[migrate] Banco "${config.db.database}" atualizado (${statements.length} instrucoes).`);
  await connection.end();
}

/**
 * Ajustes em bancos que ja existem.
 *
 * O schema.sql usa CREATE TABLE IF NOT EXISTS, entao ele nao altera tabelas
 * criadas em versoes anteriores. Os ajustes abaixo cuidam disso e sao
 * idempotentes: rodar de novo nao causa efeito nenhum.
 */
/** A tabela tem esta coluna? */
async function temColuna(connection, tabela, coluna) {
  const [linhas] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [config.db.database, tabela, coluna]
  );
  return linhas.length > 0;
}

/** O indice existe? */
async function temIndice(connection, tabela, indice) {
  const [linhas] = await connection.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [config.db.database, tabela, indice]
  );
  return linhas.length > 0;
}

/**
 * Separacao por conta em um banco que ja estava em uso.
 *
 * Tudo que existe hoje pertence a quem vinha usando o sistema, entao os
 * registros antigos sao adotados por uma primeira conta. So depois a coluna
 * vira obrigatoria e ganha a chave estrangeira - nessa ordem, senao o MySQL
 * recusa linhas sem dono.
 *
 * As chaves unicas tambem mudam de escopo: numero de maquina e documento de
 * cliente passam a ser unicos DENTRO da conta.
 */
async function aplicarSeparacaoPorConta(connection) {
  if (await temColuna(connection, 'owners', 'account_id')) return;

  const [contas] = await connection.query('SELECT id FROM accounts ORDER BY id LIMIT 1');
  let contaPadrao = contas.length ? contas[0].id : null;

  if (!contaPadrao) {
    const [resultado] = await connection.query(
      "INSERT INTO accounts (name, status) VALUES (?, 'active')",
      ['Conta principal']
    );
    contaPadrao = resultado.insertId;
  }

  const TABELAS = ['users', 'owners', 'machines', 'collections', 'audit_logs'];

  for (const tabela of TABELAS) {
    if (await temColuna(connection, tabela, 'account_id')) continue;

    // 1) entra aceitando nulo, 2) adota os registros existentes,
    // 3) so entao vira obrigatoria e ganha a chave estrangeira.
    await connection.query(`ALTER TABLE \`${tabela}\` ADD COLUMN account_id INT UNSIGNED NULL`);
    await connection.query(`UPDATE \`${tabela}\` SET account_id = ?`, [contaPadrao]);

    // audit_logs aceita nulo de proposito: eventos de sistema nao pertencem
    // a conta nenhuma.
    if (tabela !== 'audit_logs') {
      await connection.query(`ALTER TABLE \`${tabela}\` MODIFY COLUMN account_id INT UNSIGNED NOT NULL`);
    }

    await connection.query(
      `ALTER TABLE \`${tabela}\`
         ADD CONSTRAINT fk_${tabela}_account FOREIGN KEY (account_id) REFERENCES accounts (id)
         ON UPDATE CASCADE ON DELETE ${tabela === 'audit_logs' ? 'SET NULL' : 'RESTRICT'}`
    );
  }

  // Chaves unicas que passam a valer dentro da conta.
  if (await temIndice(connection, 'owners', 'uq_owners_document')) {
    await connection.query('ALTER TABLE owners DROP INDEX uq_owners_document');
  }
  if (!(await temIndice(connection, 'owners', 'uq_owners_account_document'))) {
    await connection.query(
      'ALTER TABLE owners ADD UNIQUE KEY uq_owners_account_document (account_id, document)'
    );
  }

  if (await temIndice(connection, 'machines', 'uq_machines_number')) {
    await connection.query('ALTER TABLE machines DROP INDEX uq_machines_number');
  }
  if (!(await temIndice(connection, 'machines', 'uq_machines_account_number'))) {
    await connection.query(
      'ALTER TABLE machines ADD UNIQUE KEY uq_machines_account_number (account_id, number)'
    );
  }

  console.log('[migrate] Separacao por conta aplicada. Os dados existentes ficaram na "Conta principal".');
}

/** Colunas novas em tabelas que ja existiam. */
async function aplicarColunasNovas(connection) {
  if (!(await temColuna(connection, 'users', 'must_change_password'))) {
    await connection.query(
      `ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'Senha temporaria: o sistema exige a troca no primeiro acesso'`
    );
    console.log('[migrate] Coluna de troca obrigatoria de senha criada.');
  }

  const FOTO = [
    ['document_photo_path', "VARCHAR(255) NULL COMMENT 'Caminho relativo dentro de uploads/'"],
    ['document_photo_name', 'VARCHAR(255) NULL'],
    ['document_photo_mime', 'VARCHAR(100) NULL'],
    ['document_photo_size', 'INT UNSIGNED NULL'],
    ['document_photo_checksum', "CHAR(64) NULL COMMENT 'SHA-256 do arquivo'"],
    ['document_photo_at', 'DATETIME NULL']
  ];

  for (const [coluna, definicao] of FOTO) {
    if (await temColuna(connection, 'owners', coluna)) continue;
    await connection.query(`ALTER TABLE owners ADD COLUMN ${coluna} ${definicao}`);
  }
}

async function aplicarAjustes(connection) {
  await aplicarSeparacaoPorConta(connection);
  await aplicarColunasNovas(connection);

  // O perfil "viewer" foi removido: o sistema tem apenas admin e operador.
  const [colunas] = await connection.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [config.db.database]
  );

  if (colunas.length && colunas[0].COLUMN_TYPE.includes('viewer')) {
    const [restantes] = await connection.query(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'viewer'"
    );

    if (Number(restantes[0].total) > 0) {
      await connection.query("UPDATE users SET role = 'operator' WHERE role = 'viewer'");
      console.log(`[migrate] ${restantes[0].total} usuario(s) "viewer" convertido(s) em operador.`);
    }

    await connection.query(
      `ALTER TABLE users MODIFY COLUMN role ENUM('admin','operator')
         NOT NULL DEFAULT 'operator'`
    );
    console.log('[migrate] Perfil "viewer" removido do banco.');
  }

  // Coletas cujos valores derivados nao batem com a regra vigente sao
  // corrigidas aqui, para o historico nao ficar com dois criterios
  // convivendo. Idempotente: na segunda vez nao encontra nada fora do lugar.
  await connection.beginTransaction();
  try {
    const resultado = await recalcular({ conn: connection, silencioso: true });
    await connection.commit();

    if (resultado.alteradas > 0) {
      console.log(`[migrate] ${resultado.alteradas} coleta(s) recalculada(s) para a regra ` +
        'vigente do valor bruto. Valores anteriores guardados na auditoria.');
    }
  } catch (erro) {
    await connection.rollback();
    throw erro;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[migrate] Falhou:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
