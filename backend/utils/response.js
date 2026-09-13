'use strict';

/** Resposta de sucesso padronizada da API. */
function ok(res, data = null, message = null, statusCode = 200) {
  const body = { success: true };
  if (message) body.message = message;
  if (data !== null) body.data = data;
  return res.status(statusCode).json(body);
}

function created(res, data = null, message = 'Registro criado com sucesso.') {
  return ok(res, data, message, 201);
}

/** Resposta paginada padronizada. */
function paginated(res, items, { page, pageSize, total }) {
  return res.status(200).json({
    success: true,
    data: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0
    }
  });
}

module.exports = { ok, created, paginated };
