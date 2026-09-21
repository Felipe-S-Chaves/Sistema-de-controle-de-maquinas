'use strict';

/**
 * Regra financeira central - funcao pura, sem banco.
 *
 *   Entrada apurada = entrada atual - entrada anterior
 *   Saida apurada   = saida atual   - saida anterior
 *   VALOR BRUTO     = entrada apurada - saida apurada
 *
 * "Valor bruto" e o nome novo do que o sistema chamava de valor apurado.
 * O calculo e o mesmo desde o inicio do projeto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculate } = require('../backend/services/collectionCalculator');
const money = require('../backend/utils/money');

test('exemplo da especificacao: 9500/7200 e 5800/5100 resulta em 1600', () => {
  const r = calculate({
    previousEntryCents: 720000, currentEntryCents: 950000,
    previousExitCents: 510000, currentExitCents: 580000
  });
  assert.equal(r.calculatedEntryCents, 230000, 'entrada apurada: 9500 - 7200');
  assert.equal(r.calculatedExitCents, 70000, 'saida apurada: 5800 - 5100');
  assert.equal(r.calculatedTotalCents, 160000, 'valor bruto: 2300 - 700');
  assert.equal(money.fromCents(r.calculatedTotalCents), '1600.00');
});

test('NUNCA usa entrada atual menos saida atual', () => {
  const r = calculate({
    previousEntryCents: 720000, currentEntryCents: 950000,
    previousExitCents: 510000, currentExitCents: 580000
  });
  const errado = 950000 - 580000; // 370000
  assert.notEqual(r.calculatedTotalCents, errado);
});

test('o valor bruto depende das leituras anteriores', () => {
  const comAnterior = calculate({
    previousEntryCents: 720000, currentEntryCents: 950000,
    previousExitCents: 510000, currentExitCents: 580000
  });
  const semAnterior = calculate({
    previousEntryCents: 0, currentEntryCents: 950000,
    previousExitCents: 0, currentExitCents: 580000
  });

  assert.notEqual(comAnterior.calculatedTotalCents, semAnterior.calculatedTotalCents,
    'o bruto mede o movimento desde a ultima visita, nao o acumulado do relogio');
});

test('leitura sem movimento resulta em bruto zero', () => {
  const r = calculate({
    previousEntryCents: 500000, currentEntryCents: 500000,
    previousExitCents: 300000, currentExitCents: 300000
  });
  assert.equal(r.calculatedEntryCents, 0);
  assert.equal(r.calculatedExitCents, 0);
  assert.equal(r.calculatedTotalCents, 0, 'relogios parados nao geram valor');
});

test('saida maior que entrada gera bruto negativo', () => {
  const r = calculate({
    previousEntryCents: 100000, currentEntryCents: 110000,
    previousExitCents: 100000, currentExitCents: 130000
  });
  assert.equal(r.calculatedEntryCents, 10000);
  assert.equal(r.calculatedExitCents, 30000);
  assert.equal(r.calculatedTotalCents, -20000);
});

test('detecta leitura menor que a anterior', () => {
  const r = calculate({
    previousEntryCents: 950000, currentEntryCents: 900000,
    previousExitCents: 580000, currentExitCents: 600000
  });
  assert.equal(r.entryWentBackwards, true);
  assert.equal(r.exitWentBackwards, false);
});

test('centavos nao acumulam erro de ponto flutuante', () => {
  // 0.1 + 0.2 em float daria 0.30000000000000004
  const r = calculate({
    previousEntryCents: money.toCents('0.10'), currentEntryCents: money.toCents('0.30'),
    previousExitCents: 0, currentExitCents: 0
  });
  assert.equal(money.fromCents(r.calculatedTotalCents), '0.20');
});

test('mil coletas somadas em centavos batem exatamente', () => {
  let total = 0;
  for (let i = 0; i < 1000; i += 1) {
    const r = calculate({
      previousEntryCents: 0, currentEntryCents: money.toCents('10.10'),
      previousExitCents: 0, currentExitCents: money.toCents('0.03')
    });
    total += r.calculatedTotalCents;
  }
  assert.equal(money.fromCents(total), '10070.00');
});

test('valores grandes cabem em DECIMAL(14,2)', () => {
  const r = calculate({
    previousEntryCents: 0, currentEntryCents: money.toCents('9999999999.99'),
    previousExitCents: 0, currentExitCents: 0
  });
  assert.equal(money.isValidCents(r.calculatedTotalCents), true);
  assert.equal(money.fromCents(r.calculatedTotalCents), '9999999999.99');
});

// ====================================================================
// LEITURA DIGITADA COMO NO VISOR DA MAQUINA
// ====================================================================
// O relogio nao tem ponto nem virgula: mostra 280900, e os dois ultimos
// digitos sao os centavos - ou seja, R$ 2.809,00. Os digitos JA SAO os
// centavos, entao a tela os converte direto e manda reais para a API.
// ====================================================================
test('os digitos do visor sao os centavos da leitura', () => {
  // O que a tela faz: digitos -> centavos -> reais enviados a API.
  const daTela = (digitos) => money.fromCents(Number(digitos));

  assert.equal(daTela('280900'), '2809.00');
  assert.equal(daTela('176597'), '1765.97');
  assert.equal(money.formatBRL(daTela('280900')), 'R$ 2.809,00');

  // E de volta: os centavos gravados reproduzem os digitos do visor.
  assert.equal(String(money.toCents('2809.00')), '280900');
});

test('exemplo real: BOMBA 002 com os relogios em digitos', () => {
  // Visor: 280900 / 176597 na coleta passada, 285000 / 178000 agora.
  const r = calculate({
    previousEntryCents: 280900, currentEntryCents: 285000,
    previousExitCents: 176597, currentExitCents: 178000
  });

  assert.equal(money.formatBRL(money.fromCents(r.calculatedEntryCents)), 'R$ 41,00');
  assert.equal(money.formatBRL(money.fromCents(r.calculatedExitCents)), 'R$ 14,03');
  assert.equal(money.formatBRL(money.fromCents(r.calculatedTotalCents)), 'R$ 26,97');
});

test('parser aceita formato brasileiro e americano', () => {
  assert.equal(money.toCents('1.234,56'), 123456);
  assert.equal(money.toCents('1234.56'), 123456);
  assert.equal(money.toCents('1234,56'), 123456);
  assert.equal(money.toCents('R$ 9.500,00'), 950000);
  assert.equal(money.toCents('9500'), 950000);
  assert.equal(money.toCents('abc'), null);
  assert.equal(money.toCents(''), null);
});

test('formatacao em Real brasileiro', () => {
  assert.equal(money.formatBRL('1600.00'), 'R$ 1.600,00');
  assert.equal(money.formatBRL('-1100.50'), '-R$ 1.100,50');
  assert.equal(money.formatBRL('0'), 'R$ 0,00');
});
