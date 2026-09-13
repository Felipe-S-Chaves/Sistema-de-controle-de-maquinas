'use strict';

/**
 * Cria o usuario administrador inicial (idempotente).
 * Com --demo, insere tambem dados de demonstracao.
 */

const bcrypt = require('bcryptjs');
const config = require('../config/env');
const db = require('../config/database');
const { nowForDb } = require('../utils/datetime');

const WEAK_DEFAULTS = ['Admin@123', 'admin', '123456', 'senha'];

async function seedAdmin() {
  // Em producao, nao permitir que o administrador nasca com a senha de exemplo.
  if (config.isProduction && WEAK_DEFAULTS.includes(config.admin.password)) {
    throw new Error(
      'Defina ADMIN_PASSWORD no .env com uma senha forte antes de rodar o seed em producao.'
    );
  }

  const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [config.admin.email]);
  if (existing) {
    console.log(`[seed] Administrador ja existe: ${config.admin.email}`);
    return existing.id;
  }
  const hash = await bcrypt.hash(config.admin.password, config.bcryptRounds);
  const result = await db.query(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
    [config.admin.name, config.admin.email, hash, 'admin', 'active']
  );
  console.log(`[seed] Administrador criado: ${config.admin.email}`);
  if (!config.isProduction) console.log(`[seed] Senha inicial: ${config.admin.password} - troque apos o primeiro acesso.`);
  return result.insertId;
}

async function seedDemo(userId) {
  const count = await db.queryOne('SELECT COUNT(*) AS total FROM owners');
  if (count.total > 0) {
    console.log('[seed] Dados de demonstracao ignorados (ja existem proprietarios).');
    return;
  }

  const owners = [
    ['Joao da Silva', '11144477735', 'cpf', '11988887777', '11988887777', 'joao@exemplo.com', 'Rua das Flores, 100', 'Sao Paulo', 'SP'],
    ['Maria Oliveira', '52998224725', 'cpf', '11977776666', '11977776666', 'maria@exemplo.com', 'Av. Brasil, 2200', 'Campinas', 'SP'],
    ['Bar do Ze LTDA', '11222333000181', 'cnpj', '1133334444', '11966665555', 'contato@bardoze.com', 'Rua do Porto, 45', 'Santos', 'SP']
  ];

  const ownerIds = [];
  for (const o of owners) {
    const r = await db.query(
      `INSERT INTO owners (name, document, document_type, phone, whatsapp, email, address, city, state, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...o, userId]
    );
    ownerIds.push(r.insertId);
  }

  const machines = [
    ['001', 'Maquina Principal', ownerIds[0], 'active'],
    ['002', 'Maquina Salao', ownerIds[0], 'active'],
    ['003', 'Maquina Bar', ownerIds[0], 'maintenance'],
    ['004', 'Maquina Musica', ownerIds[1], 'active'],
    ['005', 'Maquina Entrada', ownerIds[2], 'active']
  ];

  const machineIds = [];
  for (const m of machines) {
    const r = await db.query(
      `INSERT INTO machines (number, name, owner_id, status, installation_date, created_by)
       VALUES (?, ?, ?, ?, CURDATE(), ?)`,
      [m[0], m[1], m[2], m[3], userId]
    );
    machineIds.push(r.insertId);
  }

  // Historico da maquina 001 (exemplo da especificacao)
  const history = [
    { at: '2026-08-07 10:00:00', pe: '5100.00', ce: '6000.00', px: '3600.00', cx: '4200.00', first: 1 },
    { at: '2026-08-14 10:00:00', pe: '6000.00', ce: '7200.00', px: '4200.00', cx: '5100.00', first: 0 },
    { at: '2026-08-21 10:00:00', pe: '7200.00', ce: '9500.00', px: '5100.00', cx: '5800.00', first: 0 }
  ];

  for (const h of history) {
    const ce = Number(h.ce) - Number(h.pe);
    const cx = Number(h.cx) - Number(h.px);
    await db.query(
      `INSERT INTO collections
       (machine_id, owner_id, user_id, previous_entry_value, current_entry_value, calculated_entry_value,
        previous_exit_value, current_exit_value, calculated_exit_value, calculated_total_value,
        is_first_collection, observation, status, collected_at, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      [machineIds[0], ownerIds[0], userId, h.pe, h.ce, ce.toFixed(2), h.px, h.cx, cx.toFixed(2),
        (ce - cx).toFixed(2), h.first, 'Coleta de demonstracao.', h.at, config.timezone]
    );
  }

  console.log('[seed] Dados de demonstracao criados (3 proprietarios, 5 maquinas, 3 coletas).');
}

async function run() {
  const demo = process.argv.includes('--demo');
  const userId = await seedAdmin();
  if (demo) await seedDemo(userId);
  await db.close();
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error('[seed] Falhou:', error.message);
    try { await db.close(); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { run, seedAdmin, seedDemo };
