'use strict';

const machineRepository = require('../repositories/machineRepository');
const ownerRepository = require('../repositories/ownerRepository');
const collectionRepository = require('../repositories/collectionRepository');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');
const { Validator } = require('../validations/validator');
const { exigirConta } = require('../utils/tenant');

function validatePayload(body) {
  const v = new Validator(body)
    .string('number', { label: 'Numero da maquina', required: true, min: 1, max: 20 })
    .string('name', { label: 'Nome da maquina', required: true, min: 2, max: 150 })
    .integer('owner_id', { label: 'Cliente', required: true, min: 1 })
    .date('installation_date', { label: 'Data de instalacao' })
    .enum('status', ['active', 'maintenance'], { label: 'Status', defaultValue: 'active' })
    .string('notes', { label: 'Observacoes', max: 5000 });

  if (v.values.number && !/^[A-Za-z0-9\-_.]+$/.test(v.values.number)) {
    v.fail('number', 'O numero da maquina aceita apenas letras, numeros, hifen, ponto e underline.');
  }

  return v.validate();
}

async function list(query, accountId) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  const search = query.search ? String(query.search).trim().slice(0, 100) : null;
  const status = ['active', 'maintenance'].includes(query.status) ? query.status : null;
  const ownerId = parseInt(query.owner_id, 10) || null;

  const { items, total } = await machineRepository.list({
    accountId, page, pageSize, search, status, ownerId,
    orderBy: query.orderBy, orderDir: query.orderDir
  });
  return { items, total, page, pageSize };
}

async function getById(id, period, accountId) {
  const conta = exigirConta(accountId);
  const machine = await machineRepository.findById(id, conta);
  if (!machine) throw AppError.notFound('Maquina nao encontrada.');
  const summary = await machineRepository.summary(id, { ...period, accountId: conta });
  return { ...machine, summary };
}

/**
 * O cliente precisa existir DENTRO da conta.
 * Apontar uma maquina para um cliente da outra conta seria a forma mais
 * silenciosa de furar a separacao, entao a busca ja nasce filtrada.
 */
async function ensureOwnerExists(ownerId, accountId) {
  const owner = await ownerRepository.findById(ownerId, accountId);
  if (!owner) {
    throw AppError.validation('Cliente nao encontrado.', { owner_id: 'Selecione um cliente valido.' });
  }
  return owner;
}

async function create({ body, user, req }) {
  const conta = exigirConta(user.account_id);
  const data = validatePayload(body);
  await ensureOwnerExists(data.owner_id, conta);

  const duplicate = await machineRepository.findByNumber(data.number, conta);
  if (duplicate) {
    throw AppError.conflict(
      `O numero ${data.number} ja esta em uso pela maquina "${duplicate.name}".`,
      'DUPLICATE_MACHINE_NUMBER',
      { number: 'Este numero de maquina ja existe.' }
    );
  }

  const id = await machineRepository.create({ ...data, account_id: conta, created_by: user.id });
  await auditService.log({
    accountId: conta,
    userId: user.id, entity: 'machine', entityId: id, action: 'create', newValues: data, req
  });

  return machineRepository.findById(id, conta);
}

async function update({ id, body, user, req }) {
  const conta = exigirConta(user.account_id);
  const current = await machineRepository.findById(id, conta);
  if (!current) throw AppError.notFound('Maquina nao encontrada.');

  const data = validatePayload(body);
  await ensureOwnerExists(data.owner_id, conta);

  const duplicate = await machineRepository.findByNumber(data.number, conta, id);
  if (duplicate) {
    throw AppError.conflict(
      `O numero ${data.number} ja esta em uso pela maquina "${duplicate.name}".`,
      'DUPLICATE_MACHINE_NUMBER',
      { number: 'Este numero de maquina ja existe.' }
    );
  }

  // Trocar o cliente de uma maquina com historico e uma transferencia:
  // no MVP isso e bloqueado para nao desvincular coletas ja registradas.
  if (Number(data.owner_id) !== Number(current.owner_id)) {
    const totals = await collectionRepository.totals({ accountId: conta, machineId: id });
    if (Number(totals.collections_count) > 0) {
      throw AppError.conflict(
        'Esta maquina ja possui coletas registradas e nao pode trocar de cliente. Use a transferencia de maquina quando o recurso estiver disponivel.',
        'MACHINE_HAS_HISTORY',
        { owner_id: 'Maquina com historico nao pode trocar de cliente.' }
      );
    }
  }

  await machineRepository.update(id, data, conta);
  await auditService.log({
    accountId: conta,
    userId: user.id,
    entity: 'machine',
    entityId: Number(id),
    action: 'update',
    oldValues: pickAuditable(current),
    newValues: data,
    req
  });

  return machineRepository.findById(id, conta);
}

async function setStatus({ id, status, user, req }) {
  const conta = exigirConta(user.account_id);
  const current = await machineRepository.findById(id, conta);
  if (!current) throw AppError.notFound('Maquina nao encontrada.');
  if (!['active', 'maintenance'].includes(status)) {
    throw AppError.validation('Status invalido.', { status: 'Use active ou maintenance.' });
  }
  if (current.status === status) return current;

  await machineRepository.update(id, { ...current, status }, conta);
  await auditService.log({
    accountId: conta,
    userId: user.id, entity: 'machine', entityId: Number(id), action: 'status_change',
    oldValues: { status: current.status }, newValues: { status }, req
  });

  return machineRepository.findById(id, conta);
}

function pickAuditable(machine) {
  const { id, account_id, created_at, updated_at, owner_name, owner_document, ...rest } = machine;
  return rest;
}

module.exports = { list, getById, create, update, setStatus };
