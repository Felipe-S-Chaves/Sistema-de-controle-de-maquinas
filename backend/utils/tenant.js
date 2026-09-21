'use strict';

const AppError = require('./AppError');

/**
 * Guarda da separacao entre contas.
 *
 * Toda consulta que toca dado do negocio precisa dizer a qual conta pertence.
 * Se alguem escrever uma consulta nova e esquecer esse filtro, o pedido morre
 * aqui com erro 500 em vez de devolver os dados da outra conta em silencio.
 *
 * E uma troca deliberada: preferimos derrubar a requisicao a vazar informacao.
 * Os testes de isolamento dependem deste comportamento.
 */
function exigirConta(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(
      'Consulta sem conta definida. Isto e um erro de programacao, nao de uso.',
      500,
      'MISSING_ACCOUNT'
    );
  }
  return id;
}

/** O registro carregado pertence mesmo a conta de quem pediu? */
function pertenceAConta(registro, accountId) {
  if (!registro) return false;
  return Number(registro.account_id) === Number(accountId);
}

module.exports = { exigirConta, pertenceAConta };
