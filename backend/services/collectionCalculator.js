'use strict';

/**
 * REGRA FINANCEIRA CENTRAL DO SISTEMA.
 *
 *   Entrada apurada = entrada atual - entrada anterior
 *   Saida apurada   = saida atual   - saida anterior
 *   Valor apurado   = entrada apurada - saida apurada
 *
 * NUNCA e "entrada atual - saida atual".
 *
 * Toda a matematica acontece em centavos inteiros. Esta funcao e pura:
 * nao acessa banco, nao depende de request e e coberta por testes.
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
