'use strict';

const asyncHandler = require('../utils/asyncHandler');
const machineService = require('../services/machineService');
const machineRepository = require('../repositories/machineRepository');
const collectionRepository = require('../repositories/collectionRepository');
const { ok, created, paginated } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

const index = asyncHandler(async (req, res) => {
  const { items, total, page, pageSize } = await machineService.list(req.query);
  return paginated(res, items, { page, pageSize, total });
});

const show = asyncHandler(async (req, res) => {
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });
  const machine = await machineService.getById(req.params.id, period);
  return ok(res, { ...machine, period_label: period.label });
});

const store = asyncHandler(async (req, res) => {
  const machine = await machineService.create({ body: req.body, user: req.user, req });
  return created(res, machine, 'Maquina cadastrada com sucesso.');
});

const update = asyncHandler(async (req, res) => {
  const machine = await machineService.update({ id: req.params.id, body: req.body, user: req.user, req });
  return ok(res, machine, 'Maquina atualizada com sucesso.');
});

const changeStatus = asyncHandler(async (req, res) => {
  const machine = await machineService.setStatus({
    id: req.params.id, status: req.body.status, user: req.user, req
  });
  return ok(res, machine, 'Status atualizado.');
});

/** Maquinas de um proprietario - alimenta o passo 2 da nova coleta. */
const byOwner = asyncHandler(async (req, res) => {
  const items = await machineRepository.listByOwner(req.params.ownerId);
  return ok(res, items);
});

const history = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const period = resolvePeriod(req.query.period || 'all', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });

  const { items, total } = await collectionRepository.list({
    page, pageSize, machineId: req.params.id, from: period.from, to: period.to,
    status: req.query.status || null, orderDir: req.query.orderDir || 'DESC'
  });
  return paginated(res, items, { page, pageSize, total });
});

module.exports = { index, show, store, update, changeStatus, byOwner, history };
