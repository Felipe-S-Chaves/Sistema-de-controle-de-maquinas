'use strict';

const AppError = require('../utils/AppError');
const money = require('../utils/money');

/**
 * Validador minimalista e explicito (sem dependencia externa).
 * Acumula erros por campo e lanca um AppError 422 no final.
 */
class Validator {
  constructor(source = {}) {
    this.source = source || {};
    this.errors = {};
    this.values = {};
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }

  raw(field) {
    const value = this.source[field];
    return typeof value === 'string' ? value.trim() : value;
  }

  string(field, { label, required = false, min = 0, max = 255, defaultValue = null } = {}) {
    const name = label || field;
    let value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${name} e obrigatorio.`);
      this.values[field] = defaultValue;
      return this;
    }
    value = String(value);
    if (value.length < min) return this.fail(field, `${name} deve ter no minimo ${min} caracteres.`);
    if (value.length > max) return this.fail(field, `${name} deve ter no maximo ${max} caracteres.`);
    this.values[field] = value;
    return this;
  }

  email(field, { label = 'E-mail', required = false } = {}) {
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${label} e obrigatorio.`);
      this.values[field] = null;
      return this;
    }
    const normalized = String(value).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized) || normalized.length > 190) {
      return this.fail(field, `${label} invalido.`);
    }
    this.values[field] = normalized;
    return this;
  }

  integer(field, { label, required = false, min = null, max = null, defaultValue = null } = {}) {
    const name = label || field;
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${name} e obrigatorio.`);
      this.values[field] = defaultValue;
      return this;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return this.fail(field, `${name} deve ser um numero inteiro.`);
    if (min !== null && parsed < min) return this.fail(field, `${name} deve ser maior ou igual a ${min}.`);
    if (max !== null && parsed > max) return this.fail(field, `${name} deve ser menor ou igual a ${max}.`);
    this.values[field] = parsed;
    return this;
  }

  /** Valor monetario -> centavos inteiros em this.values[field]. */
  moneyCents(field, { label, required = false, min = 0 } = {}) {
    const name = label || field;
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${name} e obrigatorio.`);
      this.values[field] = null;
      return this;
    }
    const cents = money.toCents(value);
    if (cents === null) return this.fail(field, `${name} deve ser um valor monetario valido.`);
    if (!money.isValidCents(cents)) return this.fail(field, `${name} excede o limite permitido.`);
    if (min !== null && cents < min * 100) return this.fail(field, `${name} nao pode ser negativo.`);
    this.values[field] = cents;
    return this;
  }

  enum(field, allowed, { label, required = false, defaultValue = null } = {}) {
    const name = label || field;
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${name} e obrigatorio.`);
      this.values[field] = defaultValue;
      return this;
    }
    if (!allowed.includes(value)) {
      return this.fail(field, `${name} deve ser um dos valores: ${allowed.join(', ')}.`);
    }
    this.values[field] = value;
    return this;
  }

  date(field, { label, required = false } = {}) {
    const name = label || field;
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${name} e obrigatorio.`);
      this.values[field] = null;
      return this;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      return this.fail(field, `${name} deve estar no formato AAAA-MM-DD.`);
    }
    this.values[field] = value;
    return this;
  }

  boolean(field, { defaultValue = false } = {}) {
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      this.values[field] = defaultValue;
      return this;
    }
    this.values[field] = value === true || value === 'true' || value === 1 || value === '1';
    return this;
  }

  /** CPF (11) ou CNPJ (14) com validacao de digitos verificadores. */
  document(field, { label = 'CPF/CNPJ', required = false } = {}) {
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${label} e obrigatorio.`);
      this.values[field] = null;
      this.values[`${field}_type`] = null;
      return this;
    }
    const digits = String(value).replace(/\D/g, '');
    if (digits.length === 11) {
      if (!isValidCpf(digits)) return this.fail(field, 'CPF invalido.');
      this.values[field] = digits;
      this.values[`${field}_type`] = 'cpf';
      return this;
    }
    if (digits.length === 14) {
      if (!isValidCnpj(digits)) return this.fail(field, 'CNPJ invalido.');
      this.values[field] = digits;
      this.values[`${field}_type`] = 'cnpj';
      return this;
    }
    return this.fail(field, `${label} deve ter 11 digitos (CPF) ou 14 digitos (CNPJ).`);
  }

  phone(field, { label = 'Telefone', required = false } = {}) {
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (required) return this.fail(field, `${label} e obrigatorio.`);
      this.values[field] = null;
      return this;
    }
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) {
      return this.fail(field, `${label} deve conter DDD e numero (10 a 13 digitos).`);
    }
    this.values[field] = digits;
    return this;
  }

  get valid() {
    return Object.keys(this.errors).length === 0;
  }

  /** Retorna os valores validados ou lanca AppError 422. */
  validate() {
    if (!this.valid) {
      throw AppError.validation('Verifique os campos informados.', this.errors);
    }
    return this.values;
  }
}

function isValidCpf(cpf) {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function isValidCnpj(cnpj) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

module.exports = { Validator, isValidCpf, isValidCnpj };
