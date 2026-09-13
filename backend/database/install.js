'use strict';

/**
 * Instalacao completa em um comando so.
 * Uso: npm run setup
 *
 * Executa, nesta ordem:
 *   1. db:setup   - cria os bancos e o usuario da aplicacao
 *   2. migrate    - cria as tabelas
 *   3. seed       - cria o usuario administrador do sistema
 *
 * Cada etapa so roda se a anterior tiver funcionado. Se algo falhar,
 * o processo para e explica o que fazer.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const linha = (c = '-') => console.log(c.repeat(64));

/** Roda um script Node herdando o terminal (para os prompts funcionarem). */
function rodar(script, args = []) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    filho.on('close', (codigo) => resolve(codigo === 0));
    filho.on('error', () => resolve(false));
  });
}

async function main() {
  console.log('\n================================================================');
  console.log('  SISTEMA DE CONTROLE DE MAQUINAS - INSTALACAO');
  console.log('================================================================');

  // ---- Etapa 1: bancos e usuario ----
  console.log('\n[1/3] Preparando o banco de dados...\n');
  if (!await rodar('setup.js', ['--parte-da-instalacao'])) {
    console.log('\n[X] A preparacao do banco falhou. Corrija o problema acima e rode de novo:');
    console.log('    npm run setup\n');
    process.exit(1);
  }

  // ---- Etapa 2: tabelas ----
  console.log('\n[2/3] Criando as tabelas...\n');
  if (!await rodar('migrate.js')) {
    console.log('\n[X] Nao foi possivel criar as tabelas.');
    console.log('    Rode "npm run db:check" para ver o motivo.\n');
    process.exit(1);
  }

  // ---- Etapa 3: administrador ----
  console.log('\n[3/3] Criando o usuario administrador...\n');
  if (!await rodar('seed.js')) {
    console.log('\n[X] Nao foi possivel criar o administrador.');
    console.log('    Rode "npm run db:check" para ver o motivo.\n');
    process.exit(1);
  }

  const config = require('../config/env');

  console.log();
  linha('=');
  console.log('\n  INSTALACAO CONCLUIDA\n');
  linha('=');
  console.log('\nPara iniciar o sistema:\n');
  console.log('    npm start\n');
  console.log('Depois abra no navegador:\n');
  console.log(`    http://localhost:${config.port}\n`);
  console.log('Entre com:\n');
  console.log(`    E-mail: ${config.admin.email}`);
  console.log(`    Senha : ${config.admin.password}\n`);
  console.log('Troque essa senha no primeiro acesso, pelo menu do usuario.\n');
  linha();
  console.log();
}

main().catch((erro) => {
  console.error('\n[X] Erro inesperado durante a instalacao:', erro.message, '\n');
  process.exit(1);
});
