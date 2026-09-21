'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { Validator } = require('../validations/validator');
const authService = require('../services/authService');
const userRepository = require('../repositories/userRepository');
const accountRepository = require('../repositories/accountRepository');
const { ok } = require('../utils/response');
const AppError = require('../utils/AppError');

const login = asyncHandler(async (req, res) => {
  const data = new Validator(req.body)
    .email('email', { required: true })
    .string('password', { label: 'Senha', required: true, min: 1, max: 200 })
    .validate();

  const result = await authService.login({ email: data.email, password: data.password, req });
  return ok(res, result, 'Login realizado com sucesso.');
});

/**
 * Auto-cadastro de operador (rota publica).
 * A conta fica aguardando liberacao do administrador.
 */
const register = asyncHandler(async (req, res) => {
  const data = new Validator(req.body)
    .string('name', { label: 'Nome completo', required: true, min: 3, max: 150 })
    .email('email', { required: true })
    .string('password', { label: 'Senha', required: true, min: 8, max: 200 })
    .string('passwordConfirm', { label: 'Confirmacao da senha', required: true, min: 8, max: 200 })
    .integer('account_id', { label: 'Conta', required: true, min: 1 })
    .validate();

  if (data.password !== data.passwordConfirm) {
    throw AppError.validation('As senhas nao conferem.', {
      passwordConfirm: 'A confirmacao precisa ser igual a senha.'
    });
  }

  await authService.register({
    name: data.name, email: data.email, password: data.password,
    accountId: data.account_id, req
  });

  return ok(res, { pending: true },
    'Cadastro enviado. Sua conta sera liberada pelo administrador - depois disso voce ja consegue entrar.',
    201);
});

/**
 * Contas disponiveis para o cadastro (rota publica).
 * Devolve so id e nome: nada sobre o que existe dentro de cada uma.
 */
const accounts = asyncHandler(async (req, res) => {
  const contas = await accountRepository.listActive();
  return ok(res, contas.map((c) => ({ id: c.id, name: c.name })));
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout({ user: req.user, req });
  return ok(res, null, 'Sessao encerrada.');
});

const me = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.user.id, req.user.account_id);
  return ok(res, authService.publicUser({ ...user, account_name: req.user.account_name }));
});

const changePassword = asyncHandler(async (req, res) => {
  const data = new Validator(req.body)
    .string('currentPassword', { label: 'Senha atual', required: true, min: 1, max: 200 })
    .string('newPassword', { label: 'Nova senha', required: true, min: 8, max: 200 })
    .validate();

  await authService.changePassword({
    user: req.user,
    currentPassword: data.currentPassword,
    newPassword: data.newPassword,
    req
  });
  return ok(res, null, 'Senha alterada com sucesso.');
});

module.exports = { login, register, accounts, logout, me, changePassword };
