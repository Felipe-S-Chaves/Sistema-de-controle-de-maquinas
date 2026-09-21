'use strict';

/**
 * REGRA FINANCEIRA CENTRAL DO SISTEMA.
 *
 *   Entrada apurada = entrada atual - entrada anterior
 *   Saida apurada   = saida atual   - saida anterior
 *   VALOR BRUTO     = entrada apurada - saida apurada
 *
 * NUNCA e "entrada atual - saida atual": os relogios sao acumulados desde
 * que a maquina existe, entao compara-los direto devolveria um numero que
 * cresce para sempre e nao tem relacao com o que foi coletado hoje.
 *
 * "Valor bruto" e so o nome novo do que o sistema chamava de valor apurado.
 * O calculo e o mesmo desde o inicio.
 *
 * Esta funcao e a UNICA fonte da verdade: o frontend apenas repete o calculo
 * para dar retorno imediato, e o backend sempre recalcula antes de gravar.
 *
 * Toda a matematica acontece em centavos inteiros. A funcao e pura: nao acessa
 * banco, nao depende de request e e coberta por testes.
 */
function calculate({ previousEntryCents, currentEntryCents, previousExitCents, currentExitCents }) {
  const calculatedEntryCents = currentEntryCents - previousEntryCents;
  const calculatedExitCents = currentExitCents - previousExitCents;
  const calculatedTotalCents = calculatedEntryCents - calculatedExitCents;

  return {
    previousEntryCents,
    currentEntryCents,
    calculatedEntryCents,
    previousExitCents,
    currentExitCents,
    calculatedExitCents,
    calculatedTotalCents,
    entryWentBackwards: currentEntryCents < previousEntryCents,
    exitWentBackwards: currentExitCents < previousExitCents
  };
}

module.exports = { calculate };
