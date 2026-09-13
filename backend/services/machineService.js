'use strict';

const machineRepository = require('../repositories/machineRepository');
const ownerRepository = require('../repositories/ownerRepository');
const collectionRepository = require('../repositories/collectionRepository');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');
const { Validator } = require('../validations/validator');

function validatePayload(body) {
  const v = new Validator(body)
    .string('number', { label: 'Numero da maquina', required: true, min: 1, max: 20 })
    .string('name', { label: 'Nome da maquina', required: true, min: 2, max: 150 })
    .integer('owner_id', { label: 'Proprietario', required: true, min: 1 })
    .string('model', { label: 'Modelo', max: 120 })
    .string('manufacturer', { label: 'Fabricante', max: 120 })
    .string('serial_number', { label: 'Numero de serie', max: 120 })
    .date('installation_date', { label: 'Data de instalacao' })
    .enum('status', ['active', 'maintenance'], { label: 'Status', defaultValue: 'active' })
    .string('notes', { label: 'Observacoes', max: 5000 });

  if (v.values.number && !/^[A-Za-z0-9\-_.]+$/.test(v.values.number)) {
    v.fail('number', 'O numero da maquina aceita apenas letras, numeros, hifen, ponto e underline.');
  }

  return v.validate();
}

async function list(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  const search = query.search ? String(query.search).trim().slice(0, 100) : null;
  const status = ['active', 'maintenance'].includes(query.status) ? query.status : null;
  const ownerId = parseInt(query.owner_id, 10) || null;

  const { items, total } = await machineRepository.list({
    page, pageSize, search, status, ownerId, orderBy: query.orderBy, orderDir: query.orderDir
  });
  return { items, total, page, pageSize };
}

async function getById(id, period) {
  const machine = await machineRepository.findById(id);
  if (!machine) throw AppError.notFound('Maquina nao encontrada.');
  const summary = await machineRepository.summary(id, period);
  return { ...machine, summary };
}

async function ensureOwnerExists(ownerId) {
  const owner = await ownerRepository.findById(ownerId);
  if (!owner) {
    throw AppError.validation('Proprietario nao encontrado.', { owner_id: 'Selecione um proprietario valido.' });
  }
  return owner;
}

async function create({ body, user, req }) {
  const data = validatePayload(body);
  await ensureOwnerExists(data.owner_id);

  const duplicate = await machineRepository.findByNumber(data.number);
  if (duplicate) {
    throw AppError.conflict(
      `O numero ${data.number} ja esta em uso pela maquina "${duplicate.name}".`,
      'DUPLICATE_MACHINE_NUMBER',
      { number: 'Este numero de maquina ja existe.' }
    );
  }

  const id = await machineRepository.create({ ...data, created_by: user.id });
  await auditService.log({
    userId: user.id, entity: 'machine', entityId: id, action: 'create', newValues: data, req
  });

  return machineRepository.findById(id);
}

async function update({ id, body, user, req }) {
  const current = await machineRepository.findById(id);
  if (!current) throw AppError.notFound('Maquina nao encontrada.');

  const data = validatePayload(body);
  await ensureOwnerExists(data.owner_id);

  const duplicate = await machineRepository.findByNumber(data.number, id);
  if (duplicate) {
    throw AppError.conflict(
      `O numero ${data.number} ja esta em uso pela maquina "${duplicate.name}".`,
      'DUPLICATE_MACHINE_NUMBER',
      { number: 'Este numero de maquina ja existe.' }
    );
  }

  // Trocar o proprietario de uma maquina com historico e uma transferencia:
  // no MVP isso e bloqueado para nao desvincular coletas ja registradas.
  if (Number(data.owner_id) !== Number(current.owner_id)) {
    const totals = await collectionRepository.totals({ machineId: id });
    if (Number(totals.collections_count) > 0) {
      throw AppError.conflict(
        'Esta maquina ja possui coletas registradas e nao pode trocar de proprietario. Use a transferencia de maquina quando o recurso estiver disponivel.',
        'MACHINE_HAS_HISTORY',
        { owner_id: 'Maquina com historico nao pode trocar de proprietario.' }
      );
    }
  }

  await machineRepository.update(id, data);
  await auditService.log({
    userId: user.id,
    entity: 'machine',
    entityId: Number(id),
    action: 'update',
    oldValues: pickAuditable(current),
    newValues: data,
    req
  });

  return machineRepository.findById(id);
}

async function setStatus({ id, status, user, req }) {
  const current = await machineRepository.findById(id);
  if (!current) throw AppError.notFound('Maquina nao encontrada.');
  if (!['active', 'maintenance'].includes(status)) {
    throw AppError.validation('Status invalido.', { status: 'Use active ou maintenance.' });
  }
  if (current.status === status) return current;

  await machineRepository.update(id, { ...current, status });
  await auditService.log({
    userId: user.id, entity: 'machine', entityId: Number(id), action: 'status_change',
    oldValues: { status: current.status }, newValues: { status }, req
  });

  return machineRepository.findById(id);
}

function pickAuditable(machine) {
  const { id, created_at, updated_at, owner_name, owner_document, ...rest } = machine;
  return rest;
}

module.exports = { list, getById, create, update, setStatus };
