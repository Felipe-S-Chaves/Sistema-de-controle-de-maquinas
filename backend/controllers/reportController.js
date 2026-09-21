'use strict';

const asyncHandler = require('../utils/asyncHandler');
const reportService = require('../services/reportService');
const pdfService = require('../services/pdfService');
const { ok } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

/**
 * Recorte do relatorio.
 *
 * So existe um tipo de relatorio: analitico, coleta a coleta. O recorte vem do
 * cliente e das maquinas escolhidas por clique na tela - por isso
 * machine_ids aceita varios ids separados por virgula.
 */
function parseRequest(req) {
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) {
    throw AppError.validation('Periodo invalido.', {
      period: 'Informe uma data inicial e final validas (inicial <= final).'
    });
  }
  return {
    accountId: req.user.account_id,
    ownerId: parseInt(req.query.owner_id, 10) || null,
    machineIds: reportService.parseMachineIds(req.query.machine_ids, req.query.machine_id),
    period
  };
}

const period = asyncHandler(async (req, res) => {
  const report = await reportService.buildReport(parseRequest(req));
  return ok(res, report);
});

/** Gera e envia o PDF do relatorio solicitado. */
const pdf = asyncHandler(async (req, res) => {
  const report = await reportService.buildReport(parseRequest(req));
  const buffer = await pdfService.generateReportPdf(report);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `relatorio-coletas-${stamp}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${filename}"`
  );
  return res.end(buffer);
});

/**
 * Relatorio das PROPRIAS coletas.
 *
 * Quem nao tem acesso aos relatorios do negocio ainda pode prestar contas do
 * proprio trabalho. O filtro por usuario e imposto aqui, nunca vem da query.
 */
function parseOwnRequest(req) {
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) {
    throw AppError.validation('Periodo invalido.', {
      period: 'Informe uma data inicial e final validas (inicial <= final).'
    });
  }
  return { period, userId: req.user.id, accountId: req.user.account_id };
}

const own = asyncHandler(async (req, res) => {
  const { period, userId, accountId } = parseOwnRequest(req);
  const report = await reportService.buildOwnReport({
    userId, period, userName: req.user.name, accountId
  });
  return ok(res, report);
});

const ownPdf = asyncHandler(async (req, res) => {
  const { period, userId, accountId } = parseOwnRequest(req);
  const report = await reportService.buildOwnReport({
    userId, period, userName: req.user.name, accountId
  });
  const buffer = await pdfService.generateReportPdf(report);

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader(
    'Content-Disposition',
    `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="minhas-coletas-${stamp}.pdf"`
  );
  return res.end(buffer);
});

module.exports = { period, pdf, own, ownPdf };
