'use strict';

/**
 * ZERA OS DADOS OPERACIONAIS, MANTENDO O SISTEMA DE PE.
 *
 * Apaga: coletas, fotos de coleta, fotos de documento, maquinas, clientes,
 * transferencias, divisoes de receita, auditoria e usuarios que nao sejam
 * administradores. Os arquivos de imagem em uploads/ vao junto.
 *
 * Preserva: as contas (accounts) e os usuarios com papel "admin" - eles
 * continuam com o mesmo id, e-mail e senha de sempre.
 *
 * Nada de estrutura muda: nenhuma tabela e criada, alterada ou removida.
 * Os contadores AUTO_INCREMENT voltam a 1 para o sistema comecar limpo.
 *
 *   node backend/database/reset-data.js              -> so mostra o que seria apagado
 *   node backend/database/reset-data.js --confirmar  -> apaga de verdade
 */

const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const db = require('../config/database');

const CONFIRMADO = process.argv.includes('--confirmar');
const MANTER_ARQUIVOS = process.argv.includes('--manter-arquivos');

// Ordem obedece as chaves estrangeiras: filho antes do pai.
const TABELAS_ZERADAS = [
  'collection_images',
  'collections',
  'machine_transfers',
  'machine_revenue_splits',
  'machines',
  'owners',
  'audit_logs'
];

function titulo(texto) {
  console.log('');
  console.log(texto);
  console.log('-'.repeat(texto.length));
}

async function contar(tabela, where = '') {
  const linha = await db.queryOne(`SELECT COUNT(*) AS total FROM \`${tabela}\` ${where}`);
  return Number(linha.total);
}

async function retrato() {
  const dados = {};
  for (const tabela of TABELAS_ZERADAS) dados[tabela] = await contar(tabela);
  dados['users (admin)'] = await contar('users', "WHERE role = 'admin'");
  dados['users (outros)'] = await contar('users', "WHERE role <> 'admin'");
  dados['accounts'] = await contar('accounts');
  return dados;
}

function mostrarRetrato(dados) {
  const largura = Math.max(...Object.keys(dados).map((k) => k.length));
  for (const [nome, total] of Object.entries(dados)) {
    console.log(`  ${nome.padEnd(largura)} : ${total}`);
  }
}

async function listarAdministradores() {
  return db.query(
    `SELECT u.id, u.name, u.email, u.status, u.account_id, a.name AS account_name
       FROM users u
       LEFT JOIN accounts a ON a.id = u.account_id
      WHERE u.role = 'admin'
      ORDER BY u.id`
  );
}

/** Apaga os arquivos de imagem dentro de uploads/, preservando .gitkeep. */
function limparUploads() {
  const raiz = config.uploads.dir;
  if (!fs.existsSync(raiz)) return { arquivos: 0, pastas: 0 };

  let arquivos = 0;
  let pastas = 0;

  const varrer = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const alvo = path.join(dir, item.name);
      if (item.isDirectory()) {
        varrer(alvo);
        if (fs.readdirSync(alvo).length === 0) {
          fs.rmdirSync(alvo);
          pastas += 1;
        }
      } else if (item.name !== '.gitkeep') {
        fs.unlinkSync(alvo);
        arquivos += 1;
      }
    }
  };

  varrer(raiz);
  return { arquivos, pastas };
}

async function run() {
  console.log('');
  console.log('==============================================================');
  console.log('  RESET DE DADOS - Sistema de controle de maquinas');
  console.log(`  Banco: ${config.db.database} em ${config.db.host}:${config.db.port}`);
  console.log('==============================================================');

  const antes = await retrato();
  titulo('Situacao atual');
  mostrarRetrato(antes);

  const admins = await listarAdministradores();
  titulo('Administradores que serao mantidos');
  if (!admins.length) {
    console.log('  NENHUM administrador encontrado.');
    console.log('  Abortando: zerar sem admin deixaria o sistema sem acesso.');
    await db.close();
    process.exit(1);
  }
  for (const a of admins) {
    console.log(`  #${a.id}  ${a.email}  (${a.name} - conta "${a.account_name}" - ${a.status})`);
  }

  if (!CONFIRMADO) {
    titulo('Nada foi alterado');
    console.log('  Esta foi apenas uma previa. Para apagar de verdade, rode:');
    console.log('    node backend/database/reset-data.js --confirmar');
    console.log('');
    await db.close();
    return;
  }

  titulo('Apagando');
  const conexao = await db.pool.getConnection();
  try {
    await conexao.beginTransaction();
    for (const tabela of TABELAS_ZERADAS) {
      const [r] = await conexao.execute(`DELETE FROM \`${tabela}\``);
      console.log(`  ${tabela}: ${r.affectedRows} registro(s) removido(s)`);
    }
    const [ru] = await conexao.execute("DELETE FROM users WHERE role <> 'admin'");
    console.log(`  users (nao-admin): ${ru.affectedRows} registro(s) removido(s)`);
    await conexao.commit();
  } catch (erro) {
    try { await conexao.rollback(); } catch (_) { /* noop */ }
    conexao.release();
    throw erro;
  }
  conexao.release();

  // Contadores voltam a 1 (fora da transacao: e DDL).
  titulo('Reiniciando contadores');
  for (const tabela of [...TABELAS_ZERADAS]) {
    await db.query(`ALTER TABLE \`${tabela}\` AUTO_INCREMENT = 1`);
    console.log(`  ${tabela}: AUTO_INCREMENT = 1`);
  }

  if (!MANTER_ARQUIVOS) {
    titulo('Limpando uploads');
    const { arquivos, pastas } = limparUploads();
    console.log(`  ${arquivos} arquivo(s) e ${pastas} pasta(s) removidos de ${config.uploads.dir}`);
  }

  const depois = await retrato();
  titulo('Situacao final');
  mostrarRetrato(depois);

  titulo('Pronto');
  console.log('  Banco zerado. Os administradores acima seguem ativos com a');
  console.log('  mesma senha. O sistema esta pronto para o primeiro cliente.');
  console.log('');

  await db.close();
}

if (require.main === module) {
  run().catch(async (erro) => {
    console.error('');
    console.error('[reset] Falhou:', erro.message);
    try { await db.close(); } catch (_) { /* noop */ }
    process.exit(1);
  });
}

module.exports = { run };
