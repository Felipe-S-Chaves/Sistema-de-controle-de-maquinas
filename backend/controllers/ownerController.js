'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ownerService = require('../services/ownerService');
const ownerRepository = require('../repositories/ownerRepository');
const collectionRepository = require('../repositories/collectionRepository');
const { ok, created, paginated } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

const index = asyncHandler(async (req, res) => {
  const { items, total, page, pageSize } = await ownerService.list(req.query);
  return paginated(res, items, { page, pageSize, total });
});

const show = asyncHandler(async (req, res) => {
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });
  const owner = await ownerService.getById(req.params.id, period);
  return ok(res, { ...owner, period_label: period.label });
});

const store = asyncHandler(async (req, res) => {
  const owner = await ownerService.create({ body: req.body, user: req.user, req });
  return created(res, owner, 'Proprietario cadastrado com sucesso.');
});

const update = asyncHandler(async (req, res) => {
  const owner = await ownerService.update({ id: req.params.id, body: req.body, user: req.user, req });
  return ok(res, owner, 'Proprietario atualizado com sucesso.');
});

const changeStatus = asyncHandler(async (req, res) => {
  const owner = await ownerService.setStatus({
    id: req.params.id, status: req.body.status, user: req.user, req
  });
  return ok(res, owner, 'Status atualizado.');
});

const search = asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 1) return ok(res, []);
  const items = await ownerRepository.searchLight(term.slice(0, 60), 20);
  return ok(res, items);
});

const collections = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const period = resolvePeriod(req.query.period || 'all', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });

  const { items, total } = await collectionRepository.list({
    page, pageSize, ownerId: req.params.id, from: period.from, to: period.to,
    status: req.query.status || null
  });
  return paginated(res, items, { page, pageSize, total });
});

module.exports = { index, show, store, update, changeStatus, search, collections };
