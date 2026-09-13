'use strict';

/**
 * Prepara o banco de dados sem precisar do MySQL Workbench.
 * Uso: npm run db:setup
 *
 * Pergunta uma conta administrativa do MySQL (normalmente root) e, com ela:
 *   1. cria o banco principal e o de testes;
 *   2. cria o usuario da aplicacao definido no .env, se ele ainda nao existir;
 *   3. concede as permissoes necessarias.
 *
 * A senha de administrador e usada so nesta execucao e nao e gravada em lugar nenhum.
 */

const readline = require('readline');
const mysql = require('mysql2/promise');
const config = require('../config/env');
const diag = require('../utils/mysqlDiagnostics');

const linha = (c = '-') => console.log(c.repeat(64));

/**
 * Leitura da entrada.
 *
 * Usa UMA unica interface para todo o script e uma fila de linhas. Sem a fila,
 * quando a entrada vem de um pipe (e nao de um terminal) o readline entrega as
 * linhas antes da segunda pergunta ser registrada, e a resposta se perde.
 */
let iface = null;
const linhasPendentes = [];
const leitoresEsperando = [];

function abrirEntrada() {
  if (iface) return iface;
  iface = readline.createInterface({ input: process.stdin, output: process.stdout });
  iface.on('line', (valor) => {
    const proximo = leitoresEsperando.shift();
    if (proximo) proximo(valor);
    else linhasPendentes.push(valor);
  });
  return iface;
}

function fecharEntrada() {
  if (iface) { iface.close(); iface = null; }
}

function lerLinha() {
  abrirEntrada();
  return new Promise((resolve) => {
    if (linhasPendentes.length) resolve(linhasPendentes.shift());
    else leitoresEsperando.push(resolve);
  });
}

async function pergunta(texto, padrao = '') {
  abrirEntrada();
  process.stdout.write(padrao ? `${texto} [${padrao}]: ` : `${texto}: `);
  const valor = (await lerLinha()).trim();
  return valor || padrao;
}

/** Pergunta a senha escondendo o que e digitado (quando ha terminal). */
async function perguntaSenha(texto) {
  const entrada = abrirEntrada();
  process.stdout.write(`${texto}: `);

  const escreverOriginal = entrada.output.write.bind(entrada.output);
  const ehTerminal = Boolean(process.stdin.isTTY);

  if (ehTerminal) {
    entrada.output.write = (chunk, ...resto) => {
      if (typeof chunk === 'string' && chunk !== '\r\n' && chunk !== '\n') {
        return escreverOriginal('*');
      }
      return escreverOriginal(chunk, ...resto);
    };
  }

  const valor = await lerLinha();

  if (ehTerminal) entrada.output.write = escreverOriginal;
  process.stdout.write('\n');
  return valor;
}

/** Host que realmente respondeu (pode ser 127.0.0.1 quando localhost falha). */
let hostEmUso = config.db.host;

/** Tenta conectar com uma credencial, tentando IPv4 se localhost falhar. */
async function tentarConexao(user, password) {
  const resultado = await diag.conectarComFallback(
    (host) => mysql.createConnection({
      host,
      port: config.db.port,
      user,
      password,
      multipleStatements: false,
      connectTimeout: 8000
    }),
    hostEmUso,
    config.db.port
  );

  if (resultado.conexao) hostEmUso = resultado.host;
  return resultado.conexao;
}

/** O usuario informado consegue criar bancos e usuarios? */
async function ehAdministrador(conexao) {
  try {
    const [linhas] = await conexao.query('SHOW GRANTS FOR CURRENT_USER()');
    const texto = linhas.map((l) => Object.values(l)[0]).join(' ').toUpperCase();
    return texto.includes('ALL PRIVILEGES ON *.*') || texto.includes('CREATE USER');
  } catch (erro) {
    return false;
  }
}

/**
 * Antes de pedir qualquer senha, testa as credenciais administrativas mais
 * comuns. Em instalacoes tipo XAMPP, WAMP ou Laragon o root nao tem senha,
 * e nesses casos nao e preciso digitar nada.
 */
async function detectarAdmin() {
  const tentativas = [
    { user: 'root', password: '', descricao: 'root sem senha' },
    { user: 'root', password: 'root', descricao: 'root com a senha "root"' },
    { user: 'root', password: config.db.password, descricao: 'root com a senha do .env' }
  ];

  for (const t of tentativas) {
    if (t.password === undefined || t.password === null) continue;
    // eslint-disable-next-line no-await-in-loop
    const conexao = await tentarConexao(t.user, t.password);
    if (!conexao) continue;

    // eslint-disable-next-line no-await-in-loop
    if (await ehAdministrador(conexao)) {
      return { conexao, user: t.user, descricao: t.descricao };
    }
    // eslint-disable-next-line no-await-in-loop
    await conexao.end();
  }
  return null;
}

/** O usuario da aplicacao ja existe e funciona? Entao nao ha nada a fazer. */
async function jaEstaPronto() {
  const conexao = await tentarConexao(config.db.user, config.db.password);
  if (!conexao) return false;
  try {
    const [bancos] = await conexao.query('SHOW DATABASES LIKE ?', [process.env.DB_NAME || 'music_machines']);
    return bancos.length > 0;
  } catch (erro) {
    return false;
  } finally {
    await conexao.end();
  }
}

function nomeBancoTeste() {
  return process.env.DB_NAME_TEST || `${process.env.DB_NAME || 'music_machines'}_test`;
}

/** Quando chamado pelo "npm run setup", as instrucoes finais ficam por conta do instalador. */
const DENTRO_DO_INSTALADOR = process.argv.includes('--parte-da-instalacao');

async function main() {
  console.log('\nPREPARAR O BANCO DE DADOS');
  linha('=');

  const bancoApp = process.env.DB_NAME || 'music_machines';
  const bancoTeste = nomeBancoTeste();
  const usuarioApp = config.db.user;
  const senhaApp = config.db.password;

  console.log('Do seu .env:');
  console.log(`  Banco da aplicacao  : ${bancoApp}`);
  console.log(`  Banco de testes     : ${bancoTeste}`);
  console.log(`  Usuario da aplicacao: ${usuarioApp}`);
  linha();
  console.log();

  // Se ja estiver tudo pronto, nao ha o que fazer.
  if (await jaEstaPronto()) {
    console.log(`[OK] O usuario "${usuarioApp}" ja existe e o banco "${bancoApp}" tambem.`);
    console.log('     Nada a preparar.\n');
    if (!DENTRO_DO_INSTALADOR) {
      linha();
      console.log('\nPode seguir direto para:\n');
      console.log('  npm run migrate');
      console.log('  npm run seed');
      console.log('  npm start\n');
    }
    fecharEntrada();
    return;
  }

  console.log('Procurando um acesso administrativo automaticamente...');
  const detectado = await detectarAdmin();

  let conexao = null;
  let adminUser = 'root';

  if (detectado) {
    conexao = detectado.conexao;
    adminUser = detectado.user;
    console.log(`[OK] Encontrado: ${detectado.descricao}. Nao precisa digitar senha.\n`);
  } else {
    // Antes de pedir qualquer coisa, confere se o MySQL esta mesmo no ar.
    const hostVivo = await diag.encontrarHostQueResponde(config.db.host, config.db.port);
    if (!hostVivo) {
      console.log(`[X] Nada respondeu em ${config.db.host}:${config.db.port}.\n`);
      console.log('O MySQL parece estar parado.\n');
      console.log('  Windows: tecla Windows -> digite "Servicos" -> procure "MySQL80"');
      console.log('           (ou "MySQL84", "MariaDB") -> botao direito -> Iniciar');
      console.log('  Ou, num PowerShell como administrador:  net start MySQL80\n');
      console.log('Se voce usa XAMPP ou WAMP, abra o painel e inicie o MySQL por la.\n');
      console.log('Depois rode de novo:  npm run setup\n');
      fecharEntrada();
      process.exit(1);
    }
    hostEmUso = hostVivo;

    console.log(`[OK] O MySQL esta no ar em ${hostVivo}:${config.db.port}.`);
    console.log('     Falta apenas a credencial de administrador.\n');
    console.log('Digite abaixo o NOME DO USUARIO administrador do MySQL.');
    console.log('Na grande maioria dos casos e "root" - basta apertar ENTER.');
    console.log('(a senha vem na pergunta seguinte)\n');

    adminUser = await pergunta('Nome do usuario administrador', 'root');

    if (adminUser.length > 32) {
      console.log('\n[!] Esse nome tem mais de 32 caracteres, o limite do MySQL.');
      console.log('    Parece que voce colou a SENHA no lugar do nome do usuario.');
      console.log('    Vou usar "root" como usuario. A senha e a proxima pergunta.\n');
      adminUser = 'root';
    }

    const adminPass = await perguntaSenha(`Senha do usuario "${adminUser}" no MySQL`);

    console.log('\nConectando...');

    const resultado = await diag.conectarComFallback(
      (host) => mysql.createConnection({
        host,
        port: config.db.port,
        user: adminUser,
        password: adminPass,
        multipleStatements: false,
        connectTimeout: 10000
      }),
      hostEmUso,
      config.db.port
    );

    if (resultado.conexao) {
      conexao = resultado.conexao;
      hostEmUso = resultado.host;
    } else {
      const erro = resultado.erro;
      const codigo = diag.codigoErro(erro);
      console.log(`\n[X] Nao foi possivel conectar: ${diag.descreverErro(erro)}\n`);

      if (codigo === 'ER_ACCESS_DENIED_ERROR') {
        console.log(`O MySQL respondeu, mas recusou o usuario "${adminUser}" com essa senha.\n`);
        console.log('IMPORTANTE: essa senha nao e escolhida por voce agora - e a que');
        console.log('voce definiu quando INSTALOU o MySQL.\n');
        console.log('Como conferir, num PowerShell:');
        console.log(`    mysql -u ${adminUser} -p`);
        console.log('  Se entrar, a senha e essa. Se nao entrar, e outra.\n');
        console.log('Se nao lembra dela:');
        console.log('  Abra o "MySQL Installer" -> MySQL Server -> Reconfigure');
        console.log('  e defina uma senha nova para o root. Depois rode: npm run setup\n');
      } else if (codigo === 'ER_NOT_SUPPORTED_AUTH_MODE') {
        console.log('O metodo de autenticacao desse usuario nao e aceito pelo driver.\n');
        console.log('  No MySQL, rode:');
        console.log(`    ALTER USER '${adminUser}'@'localhost' IDENTIFIED WITH caching_sha2_password BY 'SuaSenha';`);
        console.log('    FLUSH PRIVILEGES;\n');
      } else if (!resultado.hostRespondeu) {
        console.log('O MySQL parou de responder no meio do processo.');
        console.log('  Verifique se o servico continua ativo e rode de novo.\n');
      } else {
        console.log('Erro inesperado ao conectar. Rode "npm run db:check" para mais detalhes.\n');
      }
      fecharEntrada();
      process.exit(1);
    }
  }

  const [quem] = await conexao.query('SELECT CURRENT_USER() AS u');
  console.log(`[OK] Conectado como ${quem[0].u}\n`);

  try {
    // ---- Bancos ----
    for (const nome of [bancoApp, bancoTeste]) {
      const [existe] = await conexao.query('SHOW DATABASES LIKE ?', [nome]);
      if (existe.length) {
        console.log(`[=]  Banco "${nome}" ja existia.`);
      } else {
        await conexao.query(
          `CREATE DATABASE \`${nome}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.log(`[OK] Banco "${nome}" criado.`);
      }
    }

    // ---- Usuario da aplicacao ----
    if (usuarioApp === adminUser) {
      console.log(`\n[=]  A aplicacao vai usar o proprio "${adminUser}". Nada a criar.`);
      console.log('     Para producao, o ideal e um usuario separado: mude DB_USER e');
      console.log('     DB_PASSWORD no .env e rode este comando de novo.');
    } else {
      if (!senhaApp) {
        console.log('\n[X] DB_PASSWORD esta vazio no .env.');
        console.log(`    Defina a senha que o usuario "${usuarioApp}" devera ter e rode de novo.\n`);
        await conexao.end();
        fecharEntrada();
        process.exit(1);
      }

      const [jaExiste] = await conexao.query(
        'SELECT 1 FROM mysql.user WHERE user = ? AND host = ?', [usuarioApp, 'localhost']
      );

      if (jaExiste.length) {
        console.log(`\n[=]  Usuario "${usuarioApp}" ja existia.`);
        const trocar = await pergunta('     Redefinir a senha dele para a que esta no .env? (s/N)', 'N');
        if (/^s/i.test(trocar)) {
          await conexao.query("ALTER USER ?@'localhost' IDENTIFIED BY ?", [usuarioApp, senhaApp]);
          console.log(`[OK] Senha de "${usuarioApp}" atualizada.`);
        }
      } else {
        await conexao.query("CREATE USER ?@'localhost' IDENTIFIED BY ?", [usuarioApp, senhaApp]);
        console.log(`\n[OK] Usuario "${usuarioApp}" criado.`);
      }

      for (const nome of [bancoApp, bancoTeste]) {
        await conexao.query(`GRANT ALL PRIVILEGES ON \`${nome}\`.* TO ?@'localhost'`, [usuarioApp]);
      }
      await conexao.query('FLUSH PRIVILEGES');
      console.log(`[OK] Permissoes concedidas em "${bancoApp}" e "${bancoTeste}".`);
    }
  } catch (erro) {
    console.log(`\n[X] Falhou: ${erro.message}`);
    if (erro.code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' || erro.code === 'ER_DBACCESS_DENIED_ERROR') {
      console.log('    O usuario informado nao tem permissao para criar bancos ou usuarios.');
      console.log('    Use uma conta administrativa (root).\n');
    }
    await conexao.end();
    fecharEntrada();
    process.exit(1);
  }

  await conexao.end();

  if (DENTRO_DO_INSTALADOR) return;

  linha();
  console.log('\nPronto. Agora rode, nesta ordem:\n');
  console.log('  npm run migrate     (cria as tabelas)');
  console.log('  npm run seed        (cria o usuario administrador do sistema)');
  console.log('  npm start           (sobe o servidor)\n');
  console.log('Depois abra http://localhost:3000 e entre com:');
  console.log(`  E-mail: ${config.admin.email}`);
  console.log('  Senha : a que esta em ADMIN_PASSWORD no .env\n');
}

main()
  .then(() => { fecharEntrada(); process.exit(0); })
  .catch((erro) => {
    fecharEntrada();
    console.error('\n[X] Erro inesperado:', erro.message, '\n');
    process.exit(1);
  });
