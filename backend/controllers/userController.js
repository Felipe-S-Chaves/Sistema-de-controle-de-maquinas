'use strict';

const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userService');
const deletionService = require('../services/deletionService');
const { ok, created, paginated } = require('../utils/response');

const index = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const search = req.query.search ? String(req.query.search).trim().slice(0, 100) : null;

  const resultado = await userService.list({
    accountId: req.user.account_id, page, pageSize, search
  });
  return paginated(res, resultado.items, {
    page: resultado.page, pageSize: resultado.pageSize, total: resultado.total
  });
});

const store = asyncHandler(async (req, res) => {
  const usuario = await userService.create({ body: req.body, user: req.user, req });
  return created(res, usuario, 'Usuario criado com sucesso.');
});

const update = asyncHandler(async (req, res) => {
  const usuario = await userService.update({ id: req.params.id, body: req.body, user: req.user, req });
  return ok(res, usuario, 'Usuario atualizado com sucesso.');
});

const changeStatus = asyncHandler(async (req, res) => {
  const usuario = await userService.setStatus({
    id: req.params.id, status: req.body.status, user: req.user, req
  });
  return ok(res, usuario, 'Status atualizado.');
});

const resetPassword = asyncHandler(async (req, res) => {
  await userService.resetPassword({
    id: req.params.id, password: req.body.password, user: req.user, req
  });
  return ok(res, null, 'Senha redefinida com sucesso.');
});

/**
 * Exclusao de usuario. Diferente de cliente e maquina: se a pessoa ja
 * registrou coletas, a conta nunca e apagada - o service responde 409 e a
 * interface orienta a desativar.
 */
const destroy = asyncHandler(async (req, res) => {
  const resumo = await deletionService.removerUsuario({
    id: req.params.id, user: req.user, req
  });
  return ok(res, resumo, 'Usuario removido.');
});

module.exports = { index, store, update, changeStatus, resetPassword, destroy };
