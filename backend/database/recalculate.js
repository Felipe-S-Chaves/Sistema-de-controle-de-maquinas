'use strict';

/**
 * Confere e conserta os valores DERIVADOS de todas as coletas ja gravadas.
 *
 * POR QUE ISTO EXISTE
 * As colunas calculadas de uma coleta saem sempre da mesma funcao pura
 * (collectionCalculator.js). Se por qualquer motivo uma linha do banco deixar
 * de bater com ela - uma versao antiga do sistema, uma alteracao feita direto
 * no MySQL, um dado importado de fora - o relatorio passa a somar numeros de
 * criterios diferentes e os totais nunca fecham com o que a tela mostra.
 * Este script traz todo o historico de volta para a regra vigente:
 *
 *   calculated_entry_value = current_entry_value - previous_entry_value
 *   calculated_exit_value  = current_exit_value  - previous_exit_value
 *   calculated_total_value = calculated_entry_value - calculated_exit_value
 *
 * O QUE ELE NAO FAZ
 * Nao inventa nem descarta nada. As leituras dos relogios (anterior e atual)
 * continuam exatamente como foram registradas no campo - elas sao o fato, e
 * so elas. O script mexe apenas no que e derivado delas.
 *
 * Coletas canceladas tambem entram: elas nao contam nos totais, mas continuam
 * visiveis no historico e nao podem exibir um numero de uma regra que nao
 * existe mais.
 *
 * Cada coleta alterada gera um registro de auditoria com o valor anterior, e
 * o processo e idempotente: rodar de novo nao muda mais nada.
 *
 * Uso:
 *   npm run recalc          -> aplica
 *   npm run recalc -- --dry -> so mostra o que mudaria
 */

const db = require('../config/database');
const money = require('../utils/money');
const { calculate } = require('../services/collectionCalculator');

const LOTE = 500;

/**
 * @param {object}  opcoes
 * @param {boolean} opcoes.dryRun      so relata, nao grava
 * @param {boolean} opcoes.silencioso  nao imprime nada
 * @param {object}  opcoes.conn        conexao de quem chamou (o migrate).
 *                                     Com ela, quem chama controla a transacao
 *                                     e o pool nem chega a ser aberto.
 */
async function recalcular({ dryRun = false, silencioso = false, conn = null } = {}) {
  const log = (mensagem) => { if (!silencioso) console.log(mensagem); };

  const consultar = conn
    ? async (sql, params = []) => { const [linhas] = await conn.execute(sql, params); return linhas; }
    : (sql, params = []) => db.query(sql, params);

  const [{ total }] = await consultar('SELECT COUNT(*) AS total FROM collections');
  if (Number(total) === 0) {
    log('[recalc] Nenhuma coleta no banco. Nada a fazer.');
    return { analisadas: 0, alteradas: 0, mudancas: [] };
  }

  let offset = 0;
  let analisadas = 0;
  const mudancas = [];

  // Percorre em lotes para nao carregar um historico inteiro na memoria.
  for (;;) {
    const linhas = await consultar(
      `SELECT id, account_id, user_id, machine_id,
              previous_entry_value, current_entry_value, calculated_entry_value,
              previous_exit_value, current_exit_value, calculated_exit_value,
              calculated_total_value, status
         FROM collections
        ORDER BY id
        LIMIT ? OFFSET ?`,
      [String(LOTE), String(offset)]
    );

    if (!linhas.length) break;

    for (const linha of linhas) {
      analisadas += 1;

      const resultado = calculate({
        previousEntryCents: money.toCents(linha.previous_entry_value),
        currentEntryCents: money.toCents(linha.current_entry_value),
        previousExitCents: money.toCents(linha.previous_exit_value),
        currentExitCents: money.toCents(linha.current_exit_value)
      });

      const novo = {
        calculated_entry_value: money.fromCents(resultado.calculatedEntryCents),
        calculated_exit_value: money.fromCents(resultado.calculatedExitCents),
        calculated_total_value: money.fromCents(resultado.calculatedTotalCents)
      };

      const antigo = {
        calculated_entry_value: money.normalize(linha.calculated_entry_value),
        calculated_exit_value: money.normalize(linha.calculated_exit_value),
        calculated_total_value: money.normalize(linha.calculated_total_value)
      };

      const mudou = Object.keys(novo).some((campo) => novo[campo] !== antigo[campo]);
      if (mudou) {
        mudancas.push({
          id: linha.id, accountId: linha.account_id, status: linha.status, antigo, novo
        });
      }
    }

    offset += linhas.length;
  }

  log(`[recalc] ${analisadas} coleta(s) analisada(s), ${mudancas.length} fora da regra atual.`);

  if (!mudancas.length) {
    log('[recalc] O historico ja esta coerente com a regra vigente.');
    return { analisadas, alteradas: 0, mudancas };
  }

  if (dryRun) {
    for (const m of mudancas.slice(0, 20)) {
      log(`[recalc]   coleta ${m.id}: ${money.formatBRL(m.antigo.calculated_total_value)} -> ` +
          `${money.formatBRL(m.novo.calculated_total_value)}`);
    }
    if (mudancas.length > 20) log(`[recalc]   ... e mais ${mudancas.length - 20}.`);
    log('[recalc] Simulacao: nada foi gravado.');
    return { analisadas, alteradas: 0, mudancas };
  }

  const gravar = async (executor) => {
    for (const m of mudancas) {
      await executor.execute(
        `UPDATE collections
            SET calculated_entry_value = ?, calculated_exit_value = ?, calculated_total_value = ?
          WHERE id = ?`,
        [m.novo.calculated_entry_value, m.novo.calculated_exit_value, m.novo.calculated_total_value, m.id]
      );

      await executor.execute(
        `INSERT INTO audit_logs
           (account_id, user_id, entity, entity_id, action, old_values, new_values, reason)
         VALUES (?, NULL, 'collection', ?, 'recalculate', ?, ?, ?)`,
        [
          m.accountId,
          m.id,
          JSON.stringify(m.antigo),
          JSON.stringify(m.novo),
          'Valores derivados reajustados para a regra vigente ' +
          '(valor bruto = entrada apurada - saida apurada). ' +
          'As leituras dos relogios nao foram tocadas.'
        ]
      );
    }
  };

  // Ou o historico inteiro migra, ou nada migra. Quando o migrate empresta a
  // propria conexao, a transacao e responsabilidade dele.
  if (conn) await gravar(conn);
  else await db.transaction(gravar);

  log(`[recalc] ${mudancas.length} coleta(s) atualizada(s). Valores anteriores guardados na auditoria.`);
  return { analisadas, alteradas: mudancas.length, mudancas };
}

if (require.main === module) {
  recalcular({ dryRun: process.argv.includes('--dry') })
    .then(() => db.close())
    .catch(async (error) => {
      console.error('[recalc] Falhou:', error.message);
      await db.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { recalcular };
