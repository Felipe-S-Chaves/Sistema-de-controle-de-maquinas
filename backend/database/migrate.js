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

const TABLES_IN_DROP_ORDER = [
  'machine_revenue_splits',
  'machine_transfers',
  'audit_logs',
  'collection_images',
  'collections',
  'machines',
  'owners',
  'users'
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

  console.log(`[migrate] Banco "${config.db.database}" atualizado (${statements.length} instrucoes).`);
  await connection.end();
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[migrate] Falhou:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
