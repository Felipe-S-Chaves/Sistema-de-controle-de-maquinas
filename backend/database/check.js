'use strict';

/**
 * Diagnóstico da conexão com o MySQL.
 * Uso: npm run db:check
 *
 * Não altera nada. Só testa a conexão e explica, em português,
 * qual é o problema e como resolver.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const diag = require('../utils/mysqlDiagnostics');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env');

const linha = (c = '-') => console.log(c.repeat(64));

function lerEnvBruto() {
  if (!fs.existsSync(ENV_PATH)) return null;
  const conteudo = fs.readFileSync(ENV_PATH, 'utf8');
  const valores = {};
  for (const raw of conteudo.split(/\r?\n/)) {
    const linhaTrim = raw.trim();
    if (!linhaTrim || linhaTrim.startsWith('#')) continue;
    const igual = raw.indexOf('=');
    if (igual === -1) continue;
    valores[raw.slice(0, igual).trim()] = raw.slice(igual + 1);
  }
  return valores;
}

/**
 * Compara o que está escrito no .env com o valor que o dotenv realmente
 * carregou. Só reporta diferenças que mudam a credencial de verdade —
 * espaços no fim, por exemplo, o dotenv já remove sozinho.
 */
function conferirEnv(bruto, config) {
  const avisos = [];
  const rawSenha = bruto.DB_PASSWORD;
  const senhaUsada = config.db.password;

  if (rawSenha === undefined) {
    avisos.push('Não existe a linha DB_PASSWORD no .env.');
    return avisos;
  }

  // O que está no arquivo, sem o que o dotenv descarta por conta própria.
  const semEspacos = rawSenha.trim();

  if (senhaUsada !== semEspacos) {
    // O dotenv mudou algo além de espaços: aspas ou comentário inline.
    if (/\s#/.test(rawSenha)) {
      avisos.push(
        'A senha tem um " #" no meio. O que vem depois do # é tratado como comentário, ' +
        'então a senha está sendo cortada. Coloque a senha entre aspas simples: ' +
        "DB_PASSWORD='sua#senha'"
      );
    } else if ((semEspacos.startsWith('"') && semEspacos.endsWith('"'))
      || (semEspacos.startsWith("'") && semEspacos.endsWith("'"))) {
      avisos.push('A senha está entre aspas e as aspas foram removidas na leitura. Isso é normal.');
    } else {
      avisos.push(`O valor lido difere do que está escrito no arquivo. Escrito: "${semEspacos}". Lido: "${senhaUsada}".`);
    }
  }

  if (senhaUsada === 'troque_esta_senha') {
    avisos.push('DB_PASSWORD ainda está com o valor de exemplo do .env.example. Coloque a senha real do MySQL.');
  }

  if (bruto.DB_USER !== undefined && config.db.user !== bruto.DB_USER.trim()) {
    avisos.push('DB_USER tem caracteres inesperados.');
  }

  return avisos;
}

async function tentar(cfg, rotulo) {
  const resultado = await diag.conectarComFallback(
    (host) => mysql.createConnection({
      host, port: cfg.port, user: cfg.user, password: cfg.password, connectTimeout: 8000
    }),
    cfg.host,
    cfg.port
  );

  if (!resultado.conexao) {
    return {
      ok: false,
      rotulo,
      code: diag.codigoErro(resultado.erro),
      message: diag.descreverErro(resultado.erro),
      hostRespondeu: resultado.hostRespondeu
    };
  }

  const conexao = resultado.conexao;
  try {
    const [rows] = await conexao.query('SELECT VERSION() AS v, CURRENT_USER() AS u');
    return { ok: true, rotulo, versao: rows[0].v, usuario: rows[0].u, host: resultado.host };
  } catch (erro) {
    return { ok: false, rotulo, code: diag.codigoErro(erro), message: diag.descreverErro(erro) };
  } finally {
    try { await conexao.end(); } catch (e) { /* noop */ }
  }
}

async function podeCriarBanco(cfg, nomeBanco) {
  let conexao;
  try {
    const r = await diag.conectarComFallback(
      (host) => mysql.createConnection({
        host, port: cfg.port, user: cfg.user, password: cfg.password
      }),
      cfg.host, cfg.port
    );
    if (!r.conexao) return { existe: false, pode: false, message: diag.descreverErro(r.erro) };
    conexao = r.conexao;
    const [bancos] = await conexao.query('SHOW DATABASES LIKE ?', [nomeBanco]);
    if (bancos.length) return { existe: true, pode: true };

    await conexao.query(`CREATE DATABASE \`${nomeBanco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conexao.query(`DROP DATABASE \`${nomeBanco}\``);
    return { existe: false, pode: true };
  } catch (erro) {
    return { existe: false, pode: false, message: erro.message };
  } finally {
    if (conexao) { try { await conexao.end(); } catch (e) { /* noop */ } }
  }
}

async function main() {
  console.log('\nDIAGNÓSTICO DA CONEXÃO COM O MYSQL');
  linha('=');

  const bruto = lerEnvBruto();
  if (!bruto) {
    console.log('\n[X] O arquivo .env não existe.\n');
    console.log('    Crie a partir do exemplo:');
    console.log('      Windows:  copy .env.example .env');
    console.log('      Linux:    cp .env.example .env\n');
    process.exit(1);
  }

  const config = require('../config/env');

  console.log('\nLendo do .env:');
  console.log(`  DB_HOST     = ${config.db.host}`);
  console.log(`  DB_PORT     = ${config.db.port}`);
  console.log(`  DB_USER     = ${config.db.user}`);
  console.log(`  DB_PASSWORD = ${config.db.password
    ? `(${config.db.password.length} caracteres, começa com "${config.db.password[0]}")`
    : '(VAZIA)'}`);
  console.log(`  DB_NAME     = ${config.db.database}`);

  const avisos = conferirEnv(bruto, config);
  if (avisos.length) {
    console.log('\nAVISOS sobre o .env:');
    avisos.forEach((a) => console.log(`  ! ${a}`));
  }

  linha();
  console.log('\nTestando a conexão...\n');

  const principal = await tentar(config.db, 'credenciais do .env');

  if (principal.ok) {
    console.log(`  [OK] Conectado como ${principal.usuario}`);
    console.log(`       Servidor: ${principal.versao}`);

    const banco = await podeCriarBanco(config.db, config.db.database);
    if (banco.existe) {
      console.log(`  [OK] O banco "${config.db.database}" já existe.`);
    } else if (banco.pode) {
      console.log(`  [OK] O usuário pode criar o banco "${config.db.database}".`);
    } else {
      console.log(`  [!]  O usuário NÃO pode criar bancos.`);
      console.log(`       Crie o banco à mão ou use um usuário com essa permissão.`);
    }

    console.log('\nTudo certo. Pode rodar:');
    console.log('  npm run migrate');
    console.log('  npm run seed');
    console.log('  npm start\n');
    process.exit(0);
  }

  // ---------- Falhou: explicar o motivo ----------
  console.log(`  [X] Falhou: ${principal.message}\n`);
  linha();

  if (principal.code === 'ECONNREFUSED' || principal.code === 'ETIMEDOUT') {
    if (principal.hostRespondeu) {
      console.log(`\nCAUSA: o MySQL responde em ${principal.hostRespondeu}:${config.db.port},`);
      console.log(`mas nao em "${config.db.host}".\n`);
      console.log('Isso costuma acontecer no Windows: "localhost" resolve para IPv6 (::1)');
      console.log('e o MySQL escuta so em IPv4.\n');
      console.log('SOLUCAO: no .env, troque a linha do host por:\n');
      console.log(`    DB_HOST=${principal.hostRespondeu}\n`);
      process.exit(1);
    }
    console.log('\nCAUSA: o MySQL não está respondendo nesse endereço/porta.\n');
    console.log('  1. O serviço do MySQL está rodando?');
    console.log('     Windows: tecla Windows -> "Serviços" -> procure "MySQL80" -> Iniciar');
    console.log('     Ou no terminal como administrador:  net start MySQL80');
    console.log(`  2. A porta está certa? O .env está usando ${config.db.port} (o padrão é 3306).`);
    console.log('  3. DB_HOST=localhost está correto se o MySQL está nesta mesma máquina.\n');
    process.exit(1);
  }

  if (principal.code === 'ENOTFOUND' || principal.code === 'EAI_AGAIN') {
    console.log(`\nCAUSA: o endereço "${config.db.host}" não foi encontrado.\n`);
    console.log('  Se o MySQL está nesta máquina, use DB_HOST=localhost\n');
    process.exit(1);
  }

  if (principal.code === 'ER_ACCESS_DENIED_ERROR') {
    console.log('\nCAUSA: usuário ou senha incorretos.\n');
    console.log('O MySQL respondeu — ou seja, ele está rodando e a porta está certa.');
    console.log('O problema é só a credencial.\n');

    // Testa senha vazia, um caso comum em instalação sem senha
    const semSenha = await tentar({ ...config.db, password: '' }, 'senha vazia');
    if (semSenha.ok) {
      console.log('  >> DESCOBERTA: este usuário conecta SEM SENHA.');
      console.log('     Deixe a linha assim no .env (sem nada depois do "="):');
      console.log('       DB_PASSWORD=\n');
      process.exit(1);
    }

    console.log('O QUE VERIFICAR, nesta ordem:\n');
    console.log('  1. A senha no .env é mesmo a do MySQL?');
    console.log('     Teste no terminal (ele vai pedir a senha):');
    console.log(`       mysql -u ${config.db.user} -p`);
    console.log('     Se entrar, a senha é essa. Se não entrar, é outra senha.\n');
    console.log('  2. A senha tem caractere especial?');
    console.log('     Se tiver # ou espaço no meio, coloque entre aspas simples:');
    console.log("       DB_PASSWORD='minha#senha com espaco'");
    console.log('     Senha simples vai sem aspas mesmo:');
    console.log('       DB_PASSWORD=MinhaSenha123\n');
    console.log('  3. Esqueceu a senha do root?');
    console.log('     Abra o "MySQL Installer" -> MySQL Server -> Reconfigure');
    console.log('     e defina uma senha nova. Depois atualize o .env.\n');
    console.log('  4. Se preferir não usar o root, crie um usuário só para o sistema.');
    console.log('     Entre no MySQL Workbench e rode:\n');
    console.log("       CREATE USER 'mm_user'@'localhost' IDENTIFIED BY 'SuaSenhaForte';");
    console.log("       CREATE DATABASE music_machines CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    console.log("       CREATE DATABASE music_machines_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    console.log("       GRANT ALL PRIVILEGES ON music_machines.* TO 'mm_user'@'localhost';");
    console.log("       GRANT ALL PRIVILEGES ON music_machines_test.* TO 'mm_user'@'localhost';");
    console.log('       FLUSH PRIVILEGES;\n');
    console.log('     Depois no .env:  DB_USER=mm_user  e  DB_PASSWORD=SuaSenhaForte\n');
    process.exit(1);
  }

  if (principal.code === 'ER_NOT_SUPPORTED_AUTH_MODE') {
    console.log('\nCAUSA: o método de autenticação do usuário não é aceito pelo driver.\n');
    console.log('  Rode no MySQL Workbench e tente de novo:\n');
    console.log(`    ALTER USER '${config.db.user}'@'localhost'`);
    console.log("      IDENTIFIED WITH caching_sha2_password BY 'SuaSenha';");
    console.log('    FLUSH PRIVILEGES;\n');
    process.exit(1);
  }

  console.log('\nErro não previsto.');
  console.log(`  Código: ${principal.code || '(sem código)'}`);
  console.log(`  Mensagem: ${principal.message}\n`);
  process.exit(1);
}

main().catch((erro) => {
  console.error('\n[X] O diagnóstico falhou:', erro.message, '\n');
  process.exit(1);
});
