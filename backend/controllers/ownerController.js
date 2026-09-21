'use strict';

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const ownerService = require('../services/ownerService');
const deletionService = require('../services/deletionService');
const ownerRepository = require('../repositories/ownerRepository');
const collectionRepository = require('../repositories/collectionRepository');
const { ok, created, paginated } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const config = require('../config/env');
const AppError = require('../utils/AppError');

const index = asyncHandler(async (req, res) => {
  const { items, total, page, pageSize } = await ownerService.list(req.query, req.user.account_id);
  return paginated(res, items, { page, pageSize, total });
});

const show = asyncHandler(async (req, res) => {
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });
  const owner = await ownerService.getById(req.params.id, period, req.user.account_id);
  return ok(res, { ...owner, period_label: period.label });
});

const store = asyncHandler(async (req, res) => {
  const owner = await ownerService.create({
    body: req.body, user: req.user, req, file: req.file
  });
  return created(res, owner, 'Cliente cadastrado com sucesso.');
});

const update = asyncHandler(async (req, res) => {
  const owner = await ownerService.update({
    id: req.params.id, body: req.body, user: req.user, req, file: req.file
  });
  return ok(res, owner, 'Cliente atualizado com sucesso.');
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
  const items = await ownerRepository.searchLight(term.slice(0, 60), req.user.account_id, 20);
  return ok(res, items);
});

const collections = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const period = resolvePeriod(req.query.period || 'all', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });

  const { items, total } = await collectionRepository.list({
    accountId: req.user.account_id,
    page, pageSize, ownerId: req.params.id, from: period.from, to: period.to,
    status: req.query.status || null
  });
  return paginated(res, items, { page, pageSize, total });
});

/**
 * Foto do documento do cliente.
 * Serve o arquivo apenas para quem esta autenticado NESTA conta - a busca ja
 * nasce filtrada, entao a foto da outra conta simplesmente nao existe daqui.
 */
const documentPhoto = asyncHandler(async (req, res) => {
  const owner = await ownerRepository.findById(req.params.id, req.user.account_id);
  if (!owner) throw AppError.notFound('Cliente nao encontrado.');
  if (!owner.document_photo_path) throw AppError.notFound('Este cliente nao tem foto de documento.');

  const absoluto = path.resolve(config.uploads.dir, owner.document_photo_path);
  const raiz = path.resolve(config.uploads.dir);

  // Defesa contra path traversal: o arquivo precisa estar sob uploads/.
  if (!absoluto.startsWith(raiz + path.sep)) throw AppError.forbidden('Acesso ao arquivo negado.');
  if (!fs.existsSync(absoluto)) throw AppError.notFound('Arquivo nao encontrado no servidor.');

  res.setHeader('Content-Type', owner.document_photo_mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.sendFile(absoluto);
});

/**
 * Exclusao definitiva. So chega aqui quem tem 'owners.delete' (administrador).
 * Sem ?cascade=1 e com historico, o service devolve 409 com o resumo para a
 * interface oferecer as duas saidas: desativar ou apagar tudo.
 */
const destroy = asyncHandler(async (req, res) => {
  const resumo = await deletionService.removerCliente({
    id: req.params.id,
    cascade: req.query.cascade === '1' || req.query.cascade === 'true',
    user: req.user,
    req
  });
  return ok(res, resumo, 'Cliente removido definitivamente.');
});

module.exports = {
  index, show, store, update, changeStatus, search, collections, documentPhoto, destroy
};
