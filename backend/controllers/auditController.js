'use strict';

const asyncHandler = require('../utils/asyncHandler');
const auditService = require('../services/auditService');
const { paginated } = require('../utils/response');
const { resolvePeriod } = require('../utils/datetime');
const AppError = require('../utils/AppError');

const index = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const periodParam = req.query.period || 'all';
  const period = resolvePeriod(periodParam, req.query.start_date, req.query.end_date);
  if (!period) throw AppError.validation('Periodo invalido.', { period: 'Informe datas validas.' });

  const { items, total } = await auditService.list({
    page,
    pageSize,
    entity: req.query.entity || null,
    entityId: parseInt(req.query.entity_id, 10) || null,
    userId: parseInt(req.query.user_id, 10) || null,
    from: period.from,
    to: period.to
  });

  return paginated(res, items, { page, pageSize, total });
});

module.exports = { index };
