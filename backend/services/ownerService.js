'use strict';

const ownerRepository = require('../repositories/ownerRepository');
const machineRepository = require('../repositories/machineRepository');
const auditService = require('./auditService');
const AppError = require('../utils/AppError');
const { Validator } = require('../validations/validator');
const { exigirConta } = require('../utils/tenant');
const { isRealImage, checksum, cleanupFiles } = require('../middlewares/upload');

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

async function list(query, accountId) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  const search = query.search ? String(query.search).trim().slice(0, 100) : null;
  const status = ['active', 'inactive'].includes(query.status) ? query.status : null;

  const { items, total } = await ownerRepository.list({
    accountId, page, pageSize, search, status, orderBy: query.orderBy, orderDir: query.orderDir
  });
  return { items, total, page, pageSize };
}

async function getById(id, period, accountId) {
  const conta = exigirConta(accountId);
  const owner = await ownerRepository.findById(id, conta);
  if (!owner) throw AppError.notFound('Cliente nao encontrado.');

  const [summary, machines] = await Promise.all([
    ownerRepository.summary(id, { ...period, accountId: conta }),
    machineRepository.listByOwner(id, conta)
  ]);

  return { ...owner, summary, machines };
}

/**
 * Foto do documento do cliente.
 *
 * O arquivo passa pelas mesmas conferencias das fotos de coleta: extensao,
 * MIME e assinatura binaria real - um .exe renomeado para .jpg nao entra.
 */
async function prepararFotoDocumento(file, req) {
  if (!file) return null;

  const real = await isRealImage(file.path).catch(() => false);
  if (!real) {
    cleanupFiles([file]);
    throw AppError.validation('O arquivo enviado nao e uma imagem valida.', {
      document_photo: 'Envie uma foto real do documento (JPG, PNG ou WEBP).'
    });
  }

  return {
    path: `${req.uploadSubdir || ''}/${file.filename}`.replace(/^\/+/, ''),
    name: file.originalname.slice(0, 255),
    mime: file.mimetype,
    size: file.size,
    checksum: await checksum(file.path).catch(() => null)
  };
}

async function create({ body, user, req, file }) {
  const conta = exigirConta(user.account_id);

  // A foto do documento e obrigatoria no cadastro: e a comprovacao de quem
  // esta sendo cadastrado. Na edicao ela ja existe e continua valendo.
  if (!file) {
    cleanupFiles([file]);
    throw AppError.validation('A foto do documento e obrigatoria.', {
      document_photo: 'Anexe a foto do documento do cliente.'
    });
  }

  let data;
  try {
    data = validatePayload(body);
  } catch (erro) {
    cleanupFiles([file]);
    throw erro;
  }

  if (data.document) {
    const duplicate = await ownerRepository.findByDocument(data.document, conta);
    if (duplicate) {
      cleanupFiles([file]);
      throw AppError.conflict(
        `Ja existe um cliente cadastrado com este CPF/CNPJ: ${duplicate.name}.`,
        'DUPLICATE_DOCUMENT',
        { document: 'CPF/CNPJ ja cadastrado.' }
      );
    }
  }

  const foto = await prepararFotoDocumento(file, req);

  const id = await ownerRepository.create({ ...data, account_id: conta, created_by: user.id });
  await ownerRepository.setDocumentPhoto(id, foto, conta);

  await auditService.log({
    accountId: conta,
    userId: user.id, entity: 'owner', entityId: id, action: 'create',
    newValues: { ...data, document_photo: foto.name }, req
  });

  return ownerRepository.findById(id, conta);
}

async function update({ id, body, user, req, file }) {
  const conta = exigirConta(user.account_id);
  const current = await ownerRepository.findById(id, conta);
  if (!current) {
    cleanupFiles([file]);
    throw AppError.notFound('Cliente nao encontrado.');
  }

  let data;
  try {
    data = validatePayload(body);
  } catch (erro) {
    cleanupFiles([file]);
    throw erro;
  }

  if (data.document) {
    const duplicate = await ownerRepository.findByDocument(data.document, conta, id);
    if (duplicate) {
      cleanupFiles([file]);
      throw AppError.conflict(
        `Ja existe um cliente cadastrado com este CPF/CNPJ: ${duplicate.name}.`,
        'DUPLICATE_DOCUMENT',
        { document: 'CPF/CNPJ ja cadastrado.' }
      );
    }
  }

  await ownerRepository.update(id, data, conta);

  // Foto nova substitui a anterior; sem foto, a que ja existia permanece.
  const foto = await prepararFotoDocumento(file, req);
  if (foto) await ownerRepository.setDocumentPhoto(id, foto, conta);

  await auditService.log({
    accountId: conta,
    userId: user.id,
    entity: 'owner',
    entityId: Number(id),
    action: 'update',
    oldValues: pickAuditable(current),
    newValues: foto ? { ...data, document_photo: foto.name } : data,
    req
  });

  return ownerRepository.findById(id, conta);
}

async function setStatus({ id, status, user, req }) {
  const conta = exigirConta(user.account_id);
  const current = await ownerRepository.findById(id, conta);
  if (!current) throw AppError.notFound('Cliente nao encontrado.');
  if (!['active', 'inactive'].includes(status)) {
    throw AppError.validation('Status invalido.', { status: 'Use active ou inactive.' });
  }
  if (current.status === status) return current;

  await ownerRepository.update(id, { ...current, status }, conta);
  await auditService.log({
    accountId: conta,
    userId: user.id, entity: 'owner', entityId: Number(id), action: 'status_change',
    oldValues: { status: current.status }, newValues: { status }, req
  });

  return ownerRepository.findById(id, conta);
}

function pickAuditable(owner) {
  const {
    id, account_id, created_at, updated_at, created_by, created_by_name,
    document_photo_path, document_photo_checksum, ...rest
  } = owner;
  return rest;
}

module.exports = { list, getById, create, update, setStatus, validatePayload };
