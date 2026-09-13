'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const config = require('../config/env');
const userRepository = require('../repositories/userRepository');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');

const GENERIC_CREDENTIALS_ERROR = 'E-mail ou senha invalidos.';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function login({ email, password, req }) {
  const user = await userRepository.findByEmail(email);

  // Mesmo sem usuario, comparamos um hash falso para evitar timing attack.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!user || !passwordMatches) {
    await auditService.log({
      userId: user ? user.id : null,
      entity: 'auth',
      entityId: user ? user.id : null,
      action: 'login_failed',
      newValues: { email },
      req
    });
    throw AppError.unauthorized(GENERIC_CREDENTIALS_ERROR, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw AppError.forbidden('Usuario inativo. Contate o administrador.');
  }

  await userRepository.touchLastLogin(user.id);
  await auditService.log({
    userId: user.id, entity: 'auth', entityId: user.id, action: 'login', req
  });

  return { token: signToken(user), user: publicUser(user), expiresIn: config.jwt.expiresIn };
}

async function logout({ user, req }) {
  await auditService.log({ userId: user.id, entity: 'auth', entityId: user.id, action: 'logout', req });
  return true;
}

async function changePassword({ user, currentPassword, newPassword, req }) {
  const row = await userRepository.findPasswordHash(user.id);
  const matches = await bcrypt.compare(currentPassword, row.password_hash);
  if (!matches) {
    throw AppError.badRequest('A senha atual esta incorreta.', 'INVALID_CURRENT_PASSWORD');
  }
  const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  await userRepository.updatePassword(user.id, hash);
  await auditService.log({
    userId: user.id, entity: 'user', entityId: user.id, action: 'change_password', req
  });
  return true;
}

module.exports = { login, logout, changePassword, signToken, publicUser };
