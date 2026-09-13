'use strict';

/** Envolve um handler async e encaminha rejeicoes para o error handler. */
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
