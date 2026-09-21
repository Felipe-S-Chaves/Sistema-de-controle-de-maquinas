'use strict';

const asyncHandler = require('../utils/asyncHandler');
const dashboardService = require('../services/dashboardService');
const { ok } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

const index = asyncHandler(async (req, res) => {
  const period = resolvePeriod(req.query.period || 'month', req.query.start_date, req.query.end_date);
  if (!period) {
    throw AppError.validation('Periodo invalido.', {
      period: 'Informe uma data inicial e final validas (inicial <= final).'
    });
  }

  const conta = req.user.account_id;
  const [metrics, latest, series] = await Promise.all([
    dashboardService.getMetrics(period, conta),
    dashboardService.getLatestCollections(conta, 8),
    dashboardService.getMonthlySeries(conta, 6)
  ]);

  return ok(res, { metrics, latest_collections: latest, monthly_series: series });
});

const search = asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 1) return ok(res, { owners: [], machines: [], total: 0 });
  const results = await dashboardService.globalSearch(term.slice(0, 60), req.user.account_id, 10);
  return ok(res, results);
});

module.exports = { index, search };
