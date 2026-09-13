'use strict';

const asyncHandler = require('../utils/asyncHandler');
const reportService = require('../services/reportService');
const pdfService = require('../services/pdfService');
const { ok } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

const VALID_TYPES = ['owners', 'machines', 'period'];

function parseRequest(req, defaultType) {
  const type = VALID_TYPES.includes(req.query.type) ? req.query.type : defaultType;
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) {
    throw AppError.validation('Periodo invalido.', {
      period: 'Informe uma data inicial e final validas (inicial <= final).'
    });
  }
  return {
    type,
    ownerId: parseInt(req.query.owner_id, 10) || null,
    machineId: parseInt(req.query.machine_id, 10) || null,
    period
  };
}

const owners = asyncHandler(async (req, res) => {
  const report = await reportService.buildReport(parseRequest(req, 'owners'));
  return ok(res, report);
});

const machines = asyncHandler(async (req, res) => {
  const report = await reportService.buildReport(parseRequest(req, 'machines'));
  return ok(res, report);
});

const period = asyncHandler(async (req, res) => {
  const report = await reportService.buildReport(parseRequest(req, 'period'));
  return ok(res, report);
});

/** Gera e envia o PDF do relatorio solicitado. */
const pdf = asyncHandler(async (req, res) => {
  const params = parseRequest(req, 'period');
  const report = await reportService.buildReport(params);
  const buffer = await pdfService.generateReportPdf(report);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `relatorio-${params.type}-${stamp}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${filename}"`
  );
  return res.end(buffer);
});

module.exports = { owners, machines, period, pdf };
