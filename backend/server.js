'use strict';

const app = require('./app');
const config = require('./config/env');
const db = require('./config/database');

async function start() {
  try {
    await db.healthCheck();
    console.log(`[db] Conectado em ${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (error) {
    const diag = require('./utils/mysqlDiagnostics');
    console.error('[db] Nao foi possivel conectar ao MySQL:', diag.descreverErro(error));

    const hostVivo = await diag.encontrarHostQueResponde(config.db.host, config.db.port);
    if (!hostVivo) {
      console.error(`[db] Nada responde em ${config.db.host}:${config.db.port}. O MySQL parece estar parado.`);
      console.error('[db] Windows: inicie o servico "MySQL80" em Servicos, ou: net start MySQL80');
    } else if (hostVivo !== config.db.host) {
      console.error(`[db] O MySQL responde em ${hostVivo}, mas nao em "${config.db.host}".`);
      console.error(`[db] Ajuste o .env para:  DB_HOST=${hostVivo}`);
    } else {
      console.error('[db] O MySQL respondeu, mas recusou a credencial.');
      console.error('[db] Rode "npm run db:check" para um diagnostico detalhado.');
    }
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`[server] Ambiente: ${config.nodeEnv}`);
    console.log(`[server] Rodando em http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] Recebido ${signal}, encerrando...`);
    server.close(async () => {
      try { await db.close(); } catch (_) { /* noop */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[server] Rejeicao nao tratada:', reason);
  });
}

start();
