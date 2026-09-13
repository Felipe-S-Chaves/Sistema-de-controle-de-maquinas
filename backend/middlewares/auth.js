'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const db = require('../config/database');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Exige um JWT valido e um usuario ativo. Popula req.user. */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw AppError.unauthorized('Autenticacao necessaria. Faca login novamente.', 'NO_TOKEN');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Sua sessao expirou. Faca login novamente.', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Token invalido. Faca login novamente.', 'INVALID_TOKEN');
  }

  const user = await db.queryOne(
    'SELECT id, name, email, role, status FROM users WHERE id = ? LIMIT 1',
    [payload.sub]
  );

  if (!user) throw AppError.unauthorized('Usuario nao encontrado.', 'INVALID_TOKEN');
  if (user.status !== 'active') throw AppError.forbidden('Usuario inativo. Contate o administrador.');

  req.user = user;
  next();
});

/** Restringe a rota aos papeis informados. */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (roles.length && !roles.includes(req.user.role)) {
      return next(AppError.forbidden());
    }
    return next();
  };
}

/** Bloqueia escrita para usuarios somente-leitura. */
const denyReadOnly = authorize('admin', 'operator');

module.exports = { authenticate, authorize, denyReadOnly, extractToken };
