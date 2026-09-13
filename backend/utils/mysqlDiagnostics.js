'use strict';

/**
 * Utilitarios de diagnostico de conexao com o MySQL.
 *
 * Resolve tres problemas reais e recorrentes no Windows:
 *
 * 1. "localhost" costuma resolver primeiro para IPv6 (::1), enquanto o MySQL
 *    escuta so em IPv4 (127.0.0.1). A conexao e recusada mesmo com o servico
 *    no ar. Por isso tentamos 127.0.0.1 como alternativa automatica.
 *
 * 2. Quando o Node tenta varios enderecos e todos falham, ele lanca um
 *    AggregateError cuja propriedade .message vem VAZIA. Sem tratar isso,
 *    o usuario ve "Nao foi possivel conectar:" sem motivo nenhum.
 *
 * 3. "Conexao recusada" e "senha errada" sao problemas completamente
 *    diferentes. Testamos a porta TCP separadamente para nunca dizer que o
 *    MySQL esta parado quando ele esta apenas recusando a credencial.
 */

const net = require('net');

/** Extrai uma mensagem util de qualquer erro, inclusive AggregateError. */
function descreverErro(erro) {
  if (!erro) return 'erro desconhecido';

  if (erro.message) return erro.message;

  // AggregateError: o Node tentou varios enderecos (IPv6 e IPv4) e todos falharam.
  if (Array.isArray(erro.errors) && erro.errors.length) {
    const partes = erro.errors
      .map((e) => (e && e.message ? e.message : e && e.code ? e.code : null))
      .filter(Boolean);
    if (partes.length) return partes.join(' / ');
  }

  if (erro.code) return erro.code;
  return String(erro);
}

/** Normaliza o codigo do erro, inclusive dentro de AggregateError. */
function codigoErro(erro) {
  if (!erro) return null;
  if (erro.code) return erro.code;
  if (Array.isArray(erro.errors)) {
    const comCodigo = erro.errors.find((e) => e && e.code);
    if (comCodigo) return comCodigo.code;
  }
  return null;
}

/** Ha algo escutando em host:porta? Responde em ate `timeout` ms. */
function portaAberta(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolvido = false;

    const terminar = (aberta) => {
      if (resolvido) return;
      resolvido = true;
      socket.destroy();
      resolve(aberta);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => terminar(true));
    socket.once('timeout', () => terminar(false));
    socket.once('error', () => terminar(false));
    socket.connect(port, host);
  });
}

/**
 * Descobre em qual endereco o MySQL responde de fato.
 * Devolve o host que funcionou, ou null se nenhum responder.
 */
async function encontrarHostQueResponde(host, port) {
  const candidatos = [host];
  if (host === 'localhost') candidatos.push('127.0.0.1');
  if (host === '127.0.0.1') candidatos.push('localhost');

  for (const candidato of candidatos) {
    // eslint-disable-next-line no-await-in-loop
    if (await portaAberta(candidato, port)) return candidato;
  }
  return null;
}

/**
 * Tenta conectar tentando tambem o endereco alternativo (IPv4/IPv6).
 * Devolve { conexao } em caso de sucesso, ou { erro, hostRespondeu }.
 *
 * `criar` e uma funcao (host) => Promise<conexao>.
 */
async function conectarComFallback(criar, host, port) {
  const candidatos = [host];
  if (host === 'localhost') candidatos.push('127.0.0.1');

  let ultimoErro = null;

  for (const candidato of candidatos) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const conexao = await criar(candidato);
      return { conexao, host: candidato, erro: null };
    } catch (erro) {
      ultimoErro = erro;
      const codigo = codigoErro(erro);
      // Se a credencial foi recusada, o endereco esta certo: nao adianta tentar outro.
      if (codigo === 'ER_ACCESS_DENIED_ERROR' || codigo === 'ER_NOT_SUPPORTED_AUTH_MODE') break;
    }
  }

  const hostRespondeu = await encontrarHostQueResponde(host, port);
  return { conexao: null, host: null, erro: ultimoErro, hostRespondeu };
}

module.exports = {
  descreverErro,
  codigoErro,
  portaAberta,
  encontrarHostQueResponde,
  conectarComFallback
};
