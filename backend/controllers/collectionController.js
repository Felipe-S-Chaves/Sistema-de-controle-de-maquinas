'use strict';

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const collectionService = require('../services/collectionService');
const collectionRepository = require('../repositories/collectionRepository');
const config = require('../config/env');
const { ok, created, paginated } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

const index = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const period = resolvePeriod(req.query.period || 'all', req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });

  const status = ['confirmed', 'cancelled'].includes(req.query.status) ? req.query.status : null;

  const { items, total } = await collectionRepository.list({
    page,
    pageSize,
    machineId: parseInt(req.query.machine_id, 10) || null,
    ownerId: parseInt(req.query.owner_id, 10) || null,
    status,
    from: period.from,
    to: period.to,
    orderDir: req.query.orderDir || 'DESC'
  });
  return paginated(res, items, { page, pageSize, total });
});

const show = asyncHandler(async (req, res) => {
  const collection = await collectionService.getDetail(req.params.id);
  return ok(res, collection);
});

/** Ultima leitura da maquina (passo 3 do fluxo de coleta). */
const lastReading = asyncHandler(async (req, res) => {
  const data = await collectionService.getLastReading(req.params.machineId);
  return ok(res, data);
});

const store = asyncHandler(async (req, res) => {
  const collection = await collectionService.createCollection({
    body: req.body, files: req.files, user: req.user, req
  });
  return created(res, collection, 'Coleta registrada com sucesso.');
});

const cancel = asyncHandler(async (req, res) => {
  const collection = await collectionService.cancelCollection({
    id: req.params.id, reason: req.body.reason, user: req.user, req
  });
  return ok(res, collection, 'Coleta cancelada. O registro permanece no historico.');
});

/** Serve a imagem apenas para usuarios autenticados. */
const image = asyncHandler(async (req, res) => {
  const record = await collectionRepository.findImageById(req.params.imageId);
  if (!record) throw AppError.notFound('Imagem nao encontrada.');

  const absolute = path.resolve(config.uploads.dir, record.file_path);
  const uploadsRoot = path.resolve(config.uploads.dir);

  // Defesa contra path traversal: o arquivo precisa estar sob uploads/.
  if (!absolute.startsWith(uploadsRoot + path.sep)) {
    throw AppError.forbidden('Acesso ao arquivo negado.');
  }
  if (!fs.existsSync(absolute)) throw AppError.notFound('Arquivo de imagem nao encontrado no servidor.');

  res.setHeader('Content-Type', record.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(record.original_name)}"`);
  }
  return res.sendFile(absolute);
});

module.exports = { index, show, lastReading, store, cancel, image };
