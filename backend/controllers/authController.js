'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { Validator } = require('../validations/validator');
const authService = require('../services/authService');
const userRepository = require('../repositories/userRepository');
const { ok } = require('../utils/response');

const login = asyncHandler(async (req, res) => {
  const data = new Validator(req.body)
    .email('email', { required: true })
    .string('password', { label: 'Senha', required: true, min: 1, max: 200 })
    .validate();

  const result = await authService.login({ email: data.email, password: data.password, req });
  return ok(res, result, 'Login realizado com sucesso.');
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout({ user: req.user, req });
  return ok(res, null, 'Sessao encerrada.');
});

const me = asyncHandler(async (req, res) => {
  const user = await userRepository.findById(req.user.id);
  return ok(res, user);
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

module.exports = { login, logout, me, changePassword };
