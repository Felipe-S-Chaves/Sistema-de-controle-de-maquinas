'use strict';

/**
 * Cria as CONTAS e seus administradores iniciais (idempotente).
 * Com --demo, insere tambem dados de demonstracao na primeira conta.
 *
 * As duas contas sao sistemas fechados e independentes: cada uma tem o proprio
 * administrador, os proprios clientes, maquinas, coletas e usuarios. Nada
 * atravessa de uma para a outra.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const db = require('../config/database');
const accountRepository = require('../repositories/accountRepository');

const WEAK_DEFAULTS = ['Admin@123', 'admin', '123456', 'senha'];

/**
 * Senha temporaria forte, sorteada na hora.
 *
 * Nao vem de arquivo nem de variavel de ambiente: aparece uma unica vez no
 * terminal de quem instala, e o sistema exige a troca no primeiro acesso.
 * Assim ela nao fica guardada em lugar nenhum.
 */
function senhaTemporaria(tamanho = 14) {
  const alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  const bytes = crypto.randomBytes(tamanho);
  let senha = '';
  for (let i = 0; i < tamanho; i += 1) senha += alfabeto[bytes[i] % alfabeto.length];
  return senha;
}

/** Administrador da primeira conta - a que ja existia. */
async function seedAdmin() {
  if (config.isProduction && WEAK_DEFAULTS.includes(config.admin.password)) {
    throw new Error(
      'Defina ADMIN_PASSWORD no .env com uma senha forte antes de rodar o seed em producao.'
    );
  }

  const contaId = await accountRepository.ensure(config.admin.accountName);

  const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [config.admin.email]);
  if (existing) {
    console.log(`[seed] Administrador ja existe: ${config.admin.email}`);
    return existing.id;
  }

  const hash = await bcrypt.hash(config.admin.password, config.bcryptRounds);
  const result = await db.query(
    `INSERT INTO users (account_id, name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [contaId, config.admin.name, config.admin.email, hash, 'admin', 'active']
  );

  console.log(`[seed] Conta "${config.admin.accountName}" - administrador criado: ${config.admin.email}`);
  if (!config.isProduction) {
    console.log(`[seed] Senha inicial: ${config.admin.password} - troque apos o primeiro acesso.`);
  }
  return result.insertId;
}

/**
 * Administrador da segunda conta.
 *
 * Nasce com senha temporaria sorteada e com a troca obrigatoria ligada: ate
 * definir uma senha propria, ele nao consegue usar o resto do sistema.
 */
async function seedSegundaConta() {
  const contaId = await accountRepository.ensure(config.admin2.accountName);

  const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [config.admin2.email]);
  if (existing) {
    console.log(`[seed] Administrador ja existe: ${config.admin2.email}`);
    return existing.id;
  }

  const senha = senhaTemporaria();
  const hash = await bcrypt.hash(senha, config.bcryptRounds);
  const result = await db.query(
    `INSERT INTO users (account_id, name, email, password_hash, role, status, must_change_password)
     VALUES (?, ?, ?, ?, 'admin', 'active', 1)`,
    [contaId, config.admin2.name, config.admin2.email, hash]
  );

  console.log('');
  console.log('  ------------------------------------------------------------');
  console.log(`  CONTA "${config.admin2.accountName}" CRIADA`);
  console.log(`  E-mail...........: ${config.admin2.email}`);
  console.log(`  Senha temporaria.: ${senha}`);
  console.log('  Anote agora: esta senha nao sera mostrada de novo.');
  console.log('  O sistema exige a troca no primeiro acesso.');
  console.log('  ------------------------------------------------------------');
  console.log('');

  return result.insertId;
}

async function seedDemo(userId) {
  const usuario = await db.queryOne('SELECT account_id FROM users WHERE id = ?', [userId]);
  const contaId = usuario.account_id;

  const count = await db.queryOne(
    'SELECT COUNT(*) AS total FROM owners WHERE account_id = ?', [contaId]
  );
  if (count.total > 0) {
    console.log('[seed] Dados de demonstracao ignorados (ja existem clientes nesta conta).');
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
      `INSERT INTO owners (account_id, name, document, document_type, phone, whatsapp, email, address, city, state, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [contaId, ...o, userId]
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
      `INSERT INTO machines (account_id, number, name, owner_id, status, installation_date, created_by)
       VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
      [contaId, m[0], m[1], m[2], m[3], userId]
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
       (account_id, machine_id, owner_id, user_id, previous_entry_value, current_entry_value, calculated_entry_value,
        previous_exit_value, current_exit_value, calculated_exit_value, calculated_total_value,
        is_first_collection, observation, status, collected_at, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      [contaId, machineIds[0], ownerIds[0], userId, h.pe, h.ce, ce.toFixed(2), h.px, h.cx, cx.toFixed(2),
        (ce - cx).toFixed(2), h.first, 'Coleta de demonstracao.', h.at, config.timezone]
    );
  }

  console.log('[seed] Dados de demonstracao criados (3 clientes, 5 maquinas, 3 coletas).');
}

async function run() {
  const demo = process.argv.includes('--demo');
  const userId = await seedAdmin();
  await seedSegundaConta();
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

module.exports = { run, seedAdmin, seedSegundaConta, seedDemo };
