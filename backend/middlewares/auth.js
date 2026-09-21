'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const db = require('../config/database');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { pode } = require('../config/permissions');

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

  // A conta vem do BANCO, nunca do token: se alguem forjar um token com outra
  // conta, o que vale aqui e o vinculo real do usuario.
  const user = await db.queryOne(
    `SELECT u.id, u.account_id, u.name, u.email, u.role, u.status, u.must_change_password,
            a.name AS account_name, a.status AS account_status
       FROM users u
       JOIN accounts a ON a.id = u.account_id
      WHERE u.id = ? LIMIT 1`,
    [payload.sub]
  );

  if (!user) throw AppError.unauthorized('Usuario nao encontrado.', 'INVALID_TOKEN');
  if (user.status !== 'active') throw AppError.forbidden('Usuario inativo. Contate o administrador.');
  if (user.account_status !== 'active') {
    throw AppError.forbidden('Esta conta esta desativada. Contate o administrador.');
  }

  req.user = user;
  next();
});

/**
 * Senha temporaria: enquanto nao for trocada, o usuario nao faz mais nada.
 *
 * Sem isto a exigencia seria so um aviso na tela, contornavel por quem
 * chamasse a API direto. Este middleware entra DEPOIS das rotas de /auth,
 * entao trocar a senha, sair e consultar o proprio perfil continuam
 * funcionando - e o resto do sistema fica fechado.
 */
function blockTemporaryPassword(req, res, next) {
  if (!req.user || !req.user.must_change_password) return next();

  return next(new AppError(
    'Sua senha e temporaria. Defina uma senha nova antes de usar o sistema.',
    403,
    'PASSWORD_CHANGE_REQUIRED'
  ));
}

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

/**
 * Restringe a rota a uma permissao declarada em config/permissions.js.
 * Preferir esta forma a listar papeis soltos: a regra fica em um lugar so.
 */
function requirePermission(permissao) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!pode(req.user.role, permissao)) {
      return next(AppError.forbidden('Seu perfil nao tem acesso a esta operacao.'));
    }
    return next();
  };
}

/** Bloqueia escrita para usuarios somente-leitura. */
const denyReadOnly = authorize('admin', 'operator');

module.exports = {
  authenticate, authorize, requirePermission, denyReadOnly, extractToken,
  blockTemporaryPassword
};
