'use strict';

const ownerRepository = require('../repositories/ownerRepository');
const machineRepository = require('../repositories/machineRepository');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');
const { Validator } = require('../validations/validator');

const BRAZIL_STATES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

function validatePayload(body) {
  const v = new Validator(body)
    .string('name', { label: 'Nome/Razao social', required: true, min: 3, max: 180 })
    .document('document')
    .phone('phone', { label: 'Telefone' })
    .phone('whatsapp', { label: 'WhatsApp' })
    .email('email')
    .string('address', { label: 'Endereco', max: 255 })
    .string('city', { label: 'Cidade', max: 120 })
    .string('notes', { label: 'Observacoes', max: 5000 })
    .enum('status', ['active', 'inactive'], { label: 'Status', defaultValue: 'active' });

  const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : null;
  if (state && !BRAZIL_STATES.includes(state)) v.fail('state', 'UF invalida.');
  v.values.state = state || null;

  const zip = typeof body.zip_code === 'string' ? body.zip_code.replace(/\D/g, '') : '';
  if (zip && zip.length !== 8) v.fail('zip_code', 'CEP deve ter 8 digitos.');
  v.values.zip_code = zip ? `${zip.slice(0, 5)}-${zip.slice(5)}` : null;

  return v.validate();
}

async function list(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  const search = query.search ? String(query.search).trim().slice(0, 100) : null;
  const status = ['active', 'inactive'].includes(query.status) ? query.status : null;

  const { items, total } = await ownerRepository.list({
    page, pageSize, search, status, orderBy: query.orderBy, orderDir: query.orderDir
  });
  return { items, total, page, pageSize };
}

async function getById(id, period) {
  const owner = await ownerRepository.findById(id);
  if (!owner) throw AppError.notFound('Proprietario nao encontrado.');

  const [summary, machines] = await Promise.all([
    ownerRepository.summary(id, period),
    machineRepository.listByOwner(id)
  ]);

  return { ...owner, summary, machines };
}

async function create({ body, user, req }) {
  const data = validatePayload(body);

  if (data.document) {
    const duplicate = await ownerRepository.findByDocument(data.document);
    if (duplicate) {
      throw AppError.conflict(
        `Ja existe um proprietario cadastrado com este CPF/CNPJ: ${duplicate.name}.`,
        'DUPLICATE_DOCUMENT',
        { document: 'CPF/CNPJ ja cadastrado.' }
      );
    }
  }

  const id = await ownerRepository.create({ ...data, created_by: user.id });
  await auditService.log({
    userId: user.id, entity: 'owner', entityId: id, action: 'create', newValues: data, req
  });

  return ownerRepository.findById(id);
}

async function update({ id, body, user, req }) {
  const current = await ownerRepository.findById(id);
  if (!current) throw AppError.notFound('Proprietario nao encontrado.');

  const data = validatePayload(body);

  if (data.document) {
    const duplicate = await ownerRepository.findByDocument(data.document, id);
    if (duplicate) {
      throw AppError.conflict(
        `Ja existe um proprietario cadastrado com este CPF/CNPJ: ${duplicate.name}.`,
        'DUPLICATE_DOCUMENT',
        { document: 'CPF/CNPJ ja cadastrado.' }
      );
    }
  }

  await ownerRepository.update(id, data);
  await auditService.log({
    userId: user.id,
    entity: 'owner',
    entityId: Number(id),
    action: 'update',
    oldValues: pickAuditable(current),
    newValues: data,
    req
  });

  return ownerRepository.findById(id);
}

async function setStatus({ id, status, user, req }) {
  const current = await ownerRepository.findById(id);
  if (!current) throw AppError.notFound('Proprietario nao encontrado.');
  if (!['active', 'inactive'].includes(status)) {
    throw AppError.validation('Status invalido.', { status: 'Use active ou inactive.' });
  }
  if (current.status === status) return current;

  await ownerRepository.update(id, { ...current, status });
  await auditService.log({
    userId: user.id, entity: 'owner', entityId: Number(id), action: 'status_change',
    oldValues: { status: current.status }, newValues: { status }, req
  });

  return ownerRepository.findById(id);
}

function pickAuditable(owner) {
  const { id, created_at, updated_at, created_by, created_by_name, ...rest } = owner;
  return rest;
}

module.exports = { list, getById, create, update, setStatus, validatePayload };
