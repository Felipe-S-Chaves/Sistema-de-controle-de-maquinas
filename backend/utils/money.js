'use strict';

/**
 * Utilitarios monetarios.
 *
 * Toda a matematica financeira do sistema acontece em CENTAVOS (inteiros),
 * evitando qualquer erro de ponto flutuante. Os valores sao persistidos
 * como DECIMAL(14,2) e trafegam na API como string decimal "1234.56".
 */

const MAX_CENTS = 999999999999; // compativel com DECIMAL(14,2)

/** Converte um valor recebido (string/number) para centavos inteiros. */
function toCents(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  let raw = String(value).trim();
  if (!raw) return null;

  // Aceita "1.234,56" (pt-BR), "1234.56" e "1234,56".
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  if (hasComma && hasDot) {
    raw = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (hasComma) {
    raw = raw.replace(',', '.');
  }

  raw = raw.replace(/\s|R\$/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/** Converte centavos inteiros para a string decimal usada no banco/API. */
function fromCents(cents) {
  if (cents === null || cents === undefined) return null;
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const integerPart = Math.trunc(abs / 100);
  const decimalPart = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${integerPart}.${decimalPart}`;
}

/** Normaliza um DECIMAL vindo do MySQL (string) para string "0.00". */
function normalize(value) {
  const cents = toCents(value);
  return cents === null ? '0.00' : fromCents(cents);
}

/** Formata em Real brasileiro para PDFs e telas geradas no backend. */
function formatBRL(value) {
  const cents = toCents(value) ?? 0;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const integerPart = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimalPart = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${integerPart},${decimalPart}`;
}

/**
 * Metade de um valor, arredondada ao centavo.
 *
 * O resultado bruto e dividido em duas partes iguais. Quando o valor tem um
 * numero impar de centavos, a metade exata nao cabe em centavos - R$ 26,97
 * daria R$ 13,485 - entao arredondamos. Por isso o relatorio calcula a metade
 * do TOTAL para o fechamento, e nao a soma das metades linha a linha: o que
 * vale para o acerto e o total.
 */
function half(value) {
  const cents = toCents(value);
  if (cents === null) return null;
  return fromCents(Math.round(cents / 2));
}

function isValidCents(cents) {
  return Number.isInteger(cents) && Math.abs(cents) <= MAX_CENTS;
}

module.exports = { toCents, fromCents, normalize, formatBRL, half, isValidCents, MAX_CENTS };
