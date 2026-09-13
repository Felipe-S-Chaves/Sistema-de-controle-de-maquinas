'use strict';

/** Validacoes de entrada: CPF, CNPJ, campos obrigatorios e periodos. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Validator, isValidCpf, isValidCnpj } = require('../backend/validations/validator');
const { resolvePeriod } = require('../backend/utils/datetime');

test('CPF valido e invalido', () => {
  assert.equal(isValidCpf('11144477735'), true);
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('11111111111'), false, 'digitos repetidos');
  assert.equal(isValidCpf('12345678900'), false, 'digito verificador errado');
});

test('CNPJ valido e invalido', () => {
  assert.equal(isValidCnpj('11222333000181'), true);
  assert.equal(isValidCnpj('11111111111111'), false);
  assert.equal(isValidCnpj('11222333000100'), false);
});

test('campo obrigatorio ausente gera erro 422 com detalhe por campo', () => {
  const v = new Validator({}).string('name', { label: 'Nome', required: true });
  assert.throws(() => v.validate(), (error) => {
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.details.name, 'Nome e obrigatorio.');
    return true;
  });
});

test('documento e normalizado para digitos e tipo detectado', () => {
  const v = new Validator({ document: '111.444.777-35' }).document('document');
  const values = v.validate();
  assert.equal(values.document, '11144477735');
  assert.equal(values.document_type, 'cpf');
});

test('e-mail invalido e rejeitado', () => {
  const v = new Validator({ email: 'sem-arroba' }).email('email');
  assert.throws(() => v.validate());
});

test('enum so aceita os valores permitidos', () => {
  const ok = new Validator({ status: 'maintenance' })
    .enum('status', ['active', 'maintenance']).validate();
  assert.equal(ok.status, 'maintenance');

  const bad = new Validator({ status: 'parada' }).enum('status', ['active', 'maintenance']);
  assert.throws(() => bad.validate());
});

test('periodo personalizado exige datas coerentes', () => {
  assert.equal(resolvePeriod('custom', '2026-08-01', '2026-08-31').label, 'Periodo personalizado');
  assert.equal(resolvePeriod('custom', '2026-08-31', '2026-08-01'), null, 'inicial depois da final');
  assert.equal(resolvePeriod('custom', 'xx', '2026-08-01'), null, 'data invalida');
});

test('periodos pre-definidos delimitam inicio e fim do dia', () => {
  const month = resolvePeriod('month');
  assert.match(month.from, /^\d{4}-\d{2}-01 00:00:00$/);
  assert.match(month.to, /23:59:59$/);

  const all = resolvePeriod('all');
  assert.equal(all.from, null);
  assert.equal(all.to, null);
});
