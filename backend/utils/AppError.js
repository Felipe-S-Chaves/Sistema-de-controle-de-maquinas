'use strict';

/** Erro de negocio previsto, seguro para exibir ao usuario final. */
class AppError extends Error {
  constructor(message, statusCode = 400, code = 'APP_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = 'BAD_REQUEST', details = null) {
    return new AppError(message, 400, code, details);
  }

  static validation(message = 'Dados invalidos.', details = null) {
    return new AppError(message, 422, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Autenticacao necessaria.', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }

  static forbidden(message = 'Voce nao tem permissao para esta operacao.') {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(message = 'Registro nao encontrado.') {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  static conflict(message, code = 'CONFLICT', details = null) {
    return new AppError(message, 409, code, details);
  }
}

module.exports = AppError;
