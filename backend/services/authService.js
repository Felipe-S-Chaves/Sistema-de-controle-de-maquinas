'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const config = require('../config/env');
const db = require('../config/database');
const userRepository = require('../repositories/userRepository');
const accountRepository = require('../repositories/accountRepository');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');
const { permissoesDoPapel, PAPEIS } = require('../config/permissions');

const GENERIC_CREDENTIALS_ERROR = 'E-mail ou senha invalidos.';

function signToken(user) {
  // A conta viaja no token so por conveniencia de leitura: quem manda e o
  // vinculo gravado no banco, conferido a cada requisicao.
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, account: user.account_id },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    role_label: PAPEIS[user.role] || user.role,
    account_id: user.account_id,
    account_name: user.account_name || null,
    must_change_password: Boolean(user.must_change_password),
    permissions: permissoesDoPapel(user.role)
  };
}

async function login({ email, password, req }) {
  const user = await userRepository.findByEmail(email);

  // Mesmo sem usuario, comparamos um hash falso para evitar timing attack.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!user || !passwordMatches) {
    // Quando o e-mail existe, a tentativa pertence a conta daquele usuario:
    // e o administrador dele que precisa enxergar isso na auditoria. E-mail
    // desconhecido nao pertence a conta nenhuma.
    await auditService.log({
      accountId: user ? user.account_id : null,
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
    throw AppError.forbidden(
      'Sua conta ainda nao foi liberada pelo administrador. Assim que ele aprovar, voce consegue entrar.'
    );
  }

  const conta = await accountRepository.findById(user.account_id);
  if (!conta || conta.status !== 'active') {
    throw AppError.forbidden('Esta conta esta desativada. Contate o administrador.');
  }

  await userRepository.touchLastLogin(user.id);
  await auditService.log({
    accountId: user.account_id,
    userId: user.id, entity: 'auth', entityId: user.id, action: 'login', req
  });

  return {
    token: signToken(user),
    user: publicUser({ ...user, account_name: conta.name }),
    expiresIn: config.jwt.expiresIn
  };
}

/**
 * Auto-cadastro de operador, feito na propria tela de login.
 *
 * A conta nasce INATIVA e so entra em uso depois que o administrador libera
 * em Usuarios. Sem isso, qualquer pessoa que alcance o endereco do sistema
 * teria acesso aos clientes e maquinas.
 *
 * O papel e fixado em 'operator' aqui dentro: nao vem do corpo da requisicao,
 * entao nao ha como se cadastrar como administrador.
 *
 * A conta e escolhida por quem se cadastra, mas so vale se existir e estiver
 * ativa - e, de todo modo, quem decide e o administrador daquela conta, que
 * precisa liberar o acesso depois.
 */
async function register({ name, email, password, accountId, req }) {
  const conta = await accountRepository.findById(accountId);
  if (!conta || conta.status !== 'active') {
    throw AppError.validation('Conta invalida.', {
      account_id: 'Escolha uma das contas disponiveis.'
    });
  }

  const existente = await userRepository.findByEmail(email);

  if (existente) {
    // Nao revelamos que o e-mail ja existe: isso permitiria descobrir
    // quem tem conta no sistema. A mensagem e a mesma do sucesso.
    await auditService.log({
      entity: 'auth', action: 'register_duplicate', newValues: { email }, req
    });
    return { pendente: true };
  }

  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const resultado = await userRepository.create({
    accountId: conta.id,
    name,
    email,
    passwordHash: hash,
    role: 'operator',
    status: 'inactive'
  });

  await auditService.log({
    accountId: conta.id,
    userId: null,
    entity: 'user',
    entityId: resultado.insertId,
    action: 'self_register',
    newValues: { name, email, role: 'operator', status: 'inactive', conta: conta.name },
    req
  });

  return { pendente: true };
}

async function logout({ user, req }) {
  await auditService.log({
    accountId: user.account_id, userId: user.id, entity: 'auth', entityId: user.id, action: 'logout', req
  });
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
    accountId: user.account_id,
    userId: user.id, entity: 'user', entityId: user.id, action: 'change_password', req
  });
  return true;
}

module.exports = { login, register, logout, changePassword, signToken, publicUser };
