'use strict';

/**
 * CONVERSAO UNICA das leituras dos relogios: divide tudo por 100.
 *
 * POR QUE ISTO EXISTE
 * O sistema interpretava os digitos do visor como reais inteiros: quem
 * digitava 280900 acabava com R$ 280.900,00 gravado. O certo e que os dois
 * ultimos digitos sao os centavos, ou seja, 280900 vale R$ 2.809,00. Todas as
 * leituras registradas antes dessa correcao estao, portanto, cem vezes
 * maiores do que deveriam.
 *
 * O que este script faz e transcrever as leituras para a escala certa:
 *
 *   R$ 280.900,00  ->  R$ 2.809,00
 *   R$ 176.597,00  ->  R$ 1.765,97
 *
 * Depois disso, os valores derivados (apuradas e valor bruto) sao refeitos
 * pela regra vigente, para o historico continuar coerente.
 *
 * ATENCAO: ESTA OPERACAO NAO E IDEMPOTENTE.
 * Dividir por 100 duas vezes divide por dez mil. Por isso o script grava uma
 * marca na auditoria e se recusa a rodar de novo. So passe --force se voce
 * tem certeza de que a conversao anterior foi desfeita.
 *
 * Uso:
 *   npm run converter-leituras -- --dry   -> mostra a conversao, sem gravar
 *   npm run converter-leituras            -> aplica
 */

const db = require('../config/database');
const money = require('../utils/money');
const { calculate } = require('../services/collectionCalculator');

const CAMPOS = [
  'previous_entry_value', 'current_entry_value',
  'previous_exit_value', 'current_exit_value'
];

const MARCA = { entity: 'system', action: 'rescale_readings' };

/** A conversao ja foi aplicada alguma vez neste banco? */
async function jaFoiAplicada() {
  const linha = await db.queryOne(
    'SELECT id, created_at FROM audit_logs WHERE entity = ? AND action = ? ORDER BY id DESC LIMIT 1',
    [MARCA.entity, MARCA.action]
  );
  return linha || null;
}

async function converter({ dryRun = false, force = false, silencioso = false } = {}) {
  const log = (mensagem) => { if (!silencioso) console.log(mensagem); };

  const marca = await jaFoiAplicada();
  if (marca && !force) {
    log(`[leituras] A conversao ja foi aplicada neste banco em ${marca.created_at}.`);
    log('[leituras] Rodar de novo dividiria os valores por 100 outra vez. Nada foi feito.');
    return { aplicada: false, motivo: 'JA_APLICADA', convertidas: 0 };
  }

  const linhas = await db.query(
    `SELECT id, account_id, previous_entry_value, current_entry_value,
            previous_exit_value, current_exit_value
       FROM collections ORDER BY id`
  );

  if (!linhas.length) {
    log('[leituras] Nenhuma coleta no banco. Nada a converter.');
    if (!dryRun) await marcarComoAplicada(null, 0);
    return { aplicada: true, convertidas: 0, restos: [] };
  }

  const conversoes = [];
  const restos = [];

  for (const linha of linhas) {
    const antigo = {};
    const novo = {};

    for (const campo of CAMPOS) {
      const centavos = money.toCents(linha[campo]) || 0;
      antigo[campo] = money.fromCents(centavos);

      // Leitura gravada como reais inteiros: os centavos sao sempre 00 e a
      // divisao e exata. Se sobrar resto, o valor nao veio da digitacao de
      // digitos - vale avisar em vez de arredondar em silencio.
      if (centavos % 100 !== 0) restos.push({ id: linha.id, campo, valor: antigo[campo] });

      novo[campo] = money.fromCents(Math.round(centavos / 100));
    }

    const resultado = calculate({
      previousEntryCents: money.toCents(novo.previous_entry_value),
      currentEntryCents: money.toCents(novo.current_entry_value),
      previousExitCents: money.toCents(novo.previous_exit_value),
      currentExitCents: money.toCents(novo.current_exit_value)
    });

    novo.calculated_entry_value = money.fromCents(resultado.calculatedEntryCents);
    novo.calculated_exit_value = money.fromCents(resultado.calculatedExitCents);
    novo.calculated_total_value = money.fromCents(resultado.calculatedTotalCents);

    conversoes.push({ id: linha.id, accountId: linha.account_id, antigo, novo });
  }

  log(`[leituras] ${conversoes.length} coleta(s) serao transcritas para a escala correta.`);

  for (const c of conversoes.slice(0, 10)) {
    log(`[leituras]   coleta ${c.id}: entrada ${money.formatBRL(c.antigo.current_entry_value)} -> ` +
        `${money.formatBRL(c.novo.current_entry_value)} | saida ` +
        `${money.formatBRL(c.antigo.current_exit_value)} -> ${money.formatBRL(c.novo.current_exit_value)}`);
  }
  if (conversoes.length > 10) log(`[leituras]   ... e mais ${conversoes.length - 10}.`);

  if (restos.length) {
    log(`[leituras] AVISO: ${restos.length} valor(es) tinham centavos diferentes de 00 e foram arredondados.`);
    for (const r of restos.slice(0, 5)) {
      log(`[leituras]   coleta ${r.id}, ${r.campo} = ${money.formatBRL(r.valor)}`);
    }
  }

  if (dryRun) {
    log('[leituras] Simulacao: nada foi gravado.');
    return { aplicada: false, motivo: 'SIMULACAO', convertidas: 0, restos, conversoes };
  }

  await db.transaction(async (conn) => {
    for (const c of conversoes) {
      await conn.execute(
        `UPDATE collections
            SET previous_entry_value = ?, current_entry_value = ?,
                previous_exit_value = ?, current_exit_value = ?,
                calculated_entry_value = ?, calculated_exit_value = ?, calculated_total_value = ?
          WHERE id = ?`,
        [c.novo.previous_entry_value, c.novo.current_entry_value,
          c.novo.previous_exit_value, c.novo.current_exit_value,
          c.novo.calculated_entry_value, c.novo.calculated_exit_value,
          c.novo.calculated_total_value, c.id]
      );

      await conn.execute(
        `INSERT INTO audit_logs
           (account_id, user_id, entity, entity_id, action, old_values, new_values, reason)
         VALUES (?, NULL, 'collection', ?, 'rescale_readings', ?, ?, ?)`,
        [
          c.accountId,
          c.id,
          JSON.stringify(c.antigo),
          JSON.stringify(c.novo),
          'Leituras transcritas para a escala correta: os dois ultimos digitos ' +
          'do visor sao os centavos. Valores divididos por 100.'
        ]
      );
    }

    await marcarComoAplicada(conn, conversoes.length);
  });

  log(`[leituras] ${conversoes.length} coleta(s) convertida(s). Valores anteriores guardados na auditoria.`);
  return { aplicada: true, convertidas: conversoes.length, restos, conversoes };
}

/** Marca que impede a conversao de rodar duas vezes. */
async function marcarComoAplicada(conn, quantidade) {
  const sql = `INSERT INTO audit_logs (user_id, entity, entity_id, action, new_values, reason)
               VALUES (NULL, ?, NULL, ?, ?, ?)`;
  const params = [
    MARCA.entity, MARCA.action,
    JSON.stringify({ coletas_convertidas: quantidade }),
    'Conversao unica das leituras (divisao por 100). Esta marca impede que ela rode de novo.'
  ];
  if (conn) await conn.execute(sql, params);
  else await db.query(sql, params);
}

if (require.main === module) {
  converter({ dryRun: process.argv.includes('--dry'), force: process.argv.includes('--force') })
    .then(() => db.close())
    .catch(async (error) => {
      console.error('[leituras] Falhou:', error.message);
      await db.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { converter, jaFoiAplicada };
