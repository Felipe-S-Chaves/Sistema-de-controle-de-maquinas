'use strict';

const multer = require('multer');
const AppError = require('../utils/AppError');
const config = require('../config/env');

/** 404 para rotas de API nao encontradas. */
function notFoundHandler(req, res, next) {
  next(new AppError(`Rota nao encontrada: ${req.method} ${req.originalUrl}`, 404, 'ROUTE_NOT_FOUND'));
}

/**
 * Handler central de erros. Resposta sempre padronizada:
 * { success: false, message, error, details? }
 * Nunca expoe stack trace ou detalhe interno ao cliente.
 */
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Ocorreu um erro inesperado. Tente novamente.';
  let details = null;

  if (error instanceof AppError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof multer.MulterError) {
    status = 422;
    code = 'UPLOAD_ERROR';
    message = error.code === 'LIMIT_FILE_SIZE'
      ? `Arquivo maior que o limite de ${Math.round(config.uploads.maxFileSizeBytes / 1024 / 1024)} MB.`
      : error.code === 'LIMIT_FILE_COUNT'
        ? `Envie no maximo ${config.uploads.maxFiles} imagens por coleta.`
        : 'Nao foi possivel processar o arquivo enviado.';
  } else if (error && error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Corpo da requisicao invalido.';
  } else if (error && error.code === 'ER_DUP_ENTRY') {
    status = 409;
    code = 'DUPLICATE_ENTRY';
    message = 'Ja existe um registro com esse valor unico.';
  } else if (error && error.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 422;
    code = 'INVALID_REFERENCE';
    message = 'Referencia invalida: verifique proprietario/maquina informados.';
  } else if (error && error.code === 'ER_ROW_IS_REFERENCED_2') {
    status = 409;
    code = 'REFERENCED_RECORD';
    message = 'Este registro possui vinculos e nao pode ser removido.';
  }

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, '-', error.message);
    if (!config.isProduction) console.error(error.stack);
  }

  const body = { success: false, message, error: code };
  if (details) body.details = details;
  if (!config.isProduction && status >= 500) body.debug = error.message;

  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
