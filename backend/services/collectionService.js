'use strict';

const db = require('../config/database');
const AppError = require('../utils/AppError');
const { exigirConta } = require('../utils/tenant');
const money = require('../utils/money');
const { nowForDb } = require('../utils/datetime');
const config = require('../config/env');

const collectionRepository = require('../repositories/collectionRepository');
const machineRepository = require('../repositories/machineRepository');
const auditService = require('./auditService');
const { calculate } = require('./collectionCalculator');
const { cleanupFiles, isRealImage, checksum } = require('../middlewares/upload');

/**
 * Ultima leitura da maquina, usada para pre-carregar a tela de nova coleta.
 * Retorna null em previous quando a maquina ainda nao tem coleta.
 */
async function getLastReading(machineId, accountId) {
  const machine = await machineRepository.findById(machineId, accountId);
  if (!machine) throw AppError.notFound('Maquina nao encontrada.');

  const last = await collectionRepository.findLastConfirmed(machineId, accountId);

  return {
    machine: {
      id: machine.id,
      number: machine.number,
      name: machine.name,
      status: machine.status,
      owner_id: machine.owner_id,
      owner_name: machine.owner_name
    },
    is_first_collection: !last,
    last_collection: last
      ? {
        id: last.id,
        collected_at: last.collected_at,
        entry_value: money.normalize(last.current_entry_value),
        exit_value: money.normalize(last.current_exit_value),
        total_value: money.normalize(last.calculated_total_value)
      }
      : null
  };
}

/**
 * Cria uma coleta.
 *
 * Pontos criticos garantidos aqui:
 *  - a leitura anterior vem SEMPRE do banco (nunca do frontend);
 *  - os valores apurados e o valor bruto sao SEMPRE recalculados no backend;
 *  - leitura menor que a anterior so passa com excecao justificada;
 *  - pelo menos uma imagem valida e obrigatoria;
 *  - tudo acontece em uma unica transacao.
 */
async function createCollection({ body, files, user, req }) {
  const conta = exigirConta(user.account_id);
  const machineId = Number(body.machine_id);

  // A foto e opcional: a coleta pode ser salva sem comprovante fotografico.
  // Quando vem foto, ela passa pelas mesmas conferencias de sempre.
  // Validacao binaria real das imagens antes de tocar no banco.
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const real = await isRealImage(file.path).catch(() => false);
    if (!real) {
      cleanupFiles(files);
      throw AppError.validation(
        'Um dos arquivos enviados nao e uma imagem valida.',
        { images: 'Arquivo de imagem invalido ou corrompido.' }
      );
    }
  }

  const currentEntryCents = money.toCents(body.current_entry_value);
  const currentExitCents = money.toCents(body.current_exit_value);

  const fieldErrors = {};
  if (currentEntryCents === null) fieldErrors.current_entry_value = 'Informe o novo relogio de entrada.';
  else if (currentEntryCents < 0) fieldErrors.current_entry_value = 'O relogio de entrada nao pode ser negativo.';
  if (currentExitCents === null) fieldErrors.current_exit_value = 'Informe o novo relogio de saida.';
  else if (currentExitCents < 0) fieldErrors.current_exit_value = 'O relogio de saida nao pode ser negativo.';
  if (!Number.isInteger(machineId) || machineId <= 0) fieldErrors.machine_id = 'Selecione uma maquina.';

  if (Object.keys(fieldErrors).length) {
    cleanupFiles(files);
    throw AppError.validation('Verifique os campos informados.', fieldErrors);
  }

  const confirmException = body.confirm_exception === true
    || body.confirm_exception === 'true' || body.confirm_exception === '1';
  const exceptionReason = typeof body.exception_reason === 'string'
    ? body.exception_reason.trim() : '';
  const observation = typeof body.observation === 'string'
    ? body.observation.trim().slice(0, 2000) : null;

  try {
    return await db.transaction(async (conn) => {
      // Trava a maquina para evitar duas coletas simultaneas na mesma maquina.
      const [machineRows] = await conn.execute(
        `SELECT id, number, name, owner_id, status FROM machines
          WHERE id = ? AND account_id = ? FOR UPDATE`,
        [machineId, conta]
      );
      if (!machineRows.length) throw AppError.notFound('Maquina nao encontrada.');
      const machine = machineRows[0];

      const last = await collectionRepository.findLastConfirmed(machineId, conta, conn);
      const isFirst = !last;

      // Leitura anterior:
      //  - coleta normal: vem SEMPRE do banco, o frontend nao tem autoridade;
      //  - primeira coleta: o operador informa o acumulado ja existente na
      //    maquina (ou deixa em branco, e assume-se zero).
      let previousEntryCents;
      let previousExitCents;

      if (isFirst) {
        previousEntryCents = money.toCents(body.previous_entry_value);
        previousExitCents = money.toCents(body.previous_exit_value);
        if (previousEntryCents === null) previousEntryCents = 0;
        if (previousExitCents === null) previousExitCents = 0;

        const firstErrors = {};
        if (previousEntryCents < 0) firstErrors.previous_entry_value = 'A leitura anterior de entrada nao pode ser negativa.';
        if (previousExitCents < 0) firstErrors.previous_exit_value = 'A leitura anterior de saida nao pode ser negativa.';
        if (Object.keys(firstErrors).length) throw AppError.validation('Verifique os campos informados.', firstErrors);
      } else {
        previousEntryCents = money.toCents(last.current_entry_value);
        previousExitCents = money.toCents(last.current_exit_value);
      }

      const result = calculate({
        previousEntryCents, currentEntryCents, previousExitCents, currentExitCents
      });

      // Leitura menor que a anterior: exige confirmacao de excecao com motivo.
      // Vale tambem na primeira coleta, quando o operador digita o acumulado anterior.
      if (result.entryWentBackwards || result.exitWentBackwards) {
        const details = {};
        if (result.entryWentBackwards) {
          details.current_entry_value =
            'A nova leitura de entrada e menor que a leitura anterior. Verifique o valor informado.';
        }
        if (result.exitWentBackwards) {
          details.current_exit_value =
            'A nova leitura de saida e menor que a leitura anterior. Verifique o valor informado.';
        }

        if (!confirmException) {
          throw new AppError(
            'A nova leitura e menor que a leitura anterior. Corrija o valor ou confirme a excecao informando o motivo.',
            409,
            'READING_LOWER_THAN_PREVIOUS',
            {
              ...details,
              previous_entry_value: money.fromCents(previousEntryCents),
              previous_exit_value: money.fromCents(previousExitCents)
            }
          );
        }

        if (exceptionReason.length < 10) {
          throw AppError.validation(
            'Informe o motivo da excecao (minimo 10 caracteres).',
            { exception_reason: 'Descreva o motivo da excecao com pelo menos 10 caracteres.' }
          );
        }
      }

      const isException = result.entryWentBackwards || result.exitWentBackwards;
      const collectedAt = nowForDb();

      const collectionId = await collectionRepository.create(conn, {
        account_id: conta,
        machine_id: machine.id,
        owner_id: machine.owner_id,
        user_id: user.id,
        previous_entry_value: money.fromCents(result.previousEntryCents),
        current_entry_value: money.fromCents(result.currentEntryCents),
        calculated_entry_value: money.fromCents(result.calculatedEntryCents),
        previous_exit_value: money.fromCents(result.previousExitCents),
        current_exit_value: money.fromCents(result.currentExitCents),
        calculated_exit_value: money.fromCents(result.calculatedExitCents),
        calculated_total_value: money.fromCents(result.calculatedTotalCents),
        is_first_collection: isFirst,
        is_exception: isException,
        exception_reason: isException ? exceptionReason : null,
        observation: observation || null,
        collected_at: collectedAt,
        timezone: config.timezone
      });

      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const sum = await checksum(file.path).catch(() => null);
        const relativePath = `${req.uploadSubdir || ''}/${file.filename}`.replace(/^\/+/, '');
        // eslint-disable-next-line no-await-in-loop
        await collectionRepository.addImage(conn, {
          collection_id: collectionId,
          user_id: user.id,
          file_path: relativePath,
          original_name: file.originalname.slice(0, 255),
          mime_type: file.mimetype,
          size_bytes: file.size,
          checksum: sum
        });
      }

      await auditService.log({
        conn,
        accountId: conta,
        userId: user.id,
        entity: 'collection',
        entityId: collectionId,
        action: isException ? 'create_exception' : 'create',
        newValues: {
          machine: `${machine.number} - ${machine.name}`,
          previous_entry_value: money.fromCents(result.previousEntryCents),
          current_entry_value: money.fromCents(result.currentEntryCents),
          calculated_entry_value: money.fromCents(result.calculatedEntryCents),
          previous_exit_value: money.fromCents(result.previousExitCents),
          current_exit_value: money.fromCents(result.currentExitCents),
          calculated_exit_value: money.fromCents(result.calculatedExitCents),
          calculated_total_value: money.fromCents(result.calculatedTotalCents),
          images: files.length,
          is_first_collection: isFirst
        },
        reason: isException ? exceptionReason : null,
        req
      });

      return getDetail(collectionId, conta, conn);
    });
  } catch (error) {
    cleanupFiles(files);
    throw error;
  }
}

/** Detalhe completo da coleta, com imagens. */
async function getDetail(id, accountId, conn = null) {
  const conta = exigirConta(accountId);

  if (conn) {
    const [rows] = await conn.execute(
      `SELECT c.*, m.number AS machine_number, m.name AS machine_name,
              o.name AS owner_name, u.name AS user_name
         FROM collections c
         JOIN machines m ON m.id = c.machine_id
         JOIN owners o   ON o.id = c.owner_id
         JOIN users u    ON u.id = c.user_id
        WHERE c.id = ? AND c.account_id = ?`,
      [id, conta]
    );
    if (!rows.length) throw AppError.notFound('Coleta nao encontrada.');
    const [images] = await conn.execute(
      'SELECT id, file_path, original_name, mime_type, size_bytes FROM collection_images WHERE collection_id = ? ORDER BY id',
      [id]
    );
    return { ...rows[0], images };
  }

  const collection = await collectionRepository.findDetail(id, conta);
  if (!collection) throw AppError.notFound('Coleta nao encontrada.');
  const images = await collectionRepository.listImages(id, conta);
  return { ...collection, images };
}

/**
 * Cancela uma coleta. Nunca remove fisicamente.
 * Bloqueia o cancelamento se ja existir coleta posterior baseada nesta leitura,
 * porque isso quebraria o encadeamento do historico.
 */
async function cancelCollection({ id, reason, user, req }) {
  const conta = exigirConta(user.account_id);
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 10) {
    throw AppError.validation(
      'Informe o motivo do cancelamento (minimo 10 caracteres).',
      { reason: 'Descreva o motivo com pelo menos 10 caracteres.' }
    );
  }

  return db.transaction(async (conn) => {
    const collection = await collectionRepository.findForUpdate(conn, id, conta);
    if (!collection) throw AppError.notFound('Coleta nao encontrada.');
    if (collection.status === 'cancelled') {
      throw AppError.conflict('Esta coleta ja esta cancelada.', 'ALREADY_CANCELLED');
    }

    const hasLater = await collectionRepository.hasLaterConfirmed(conn, collection);
    if (hasLater) {
      throw AppError.conflict(
        'Existe uma coleta posterior confirmada para esta maquina. Cancele a coleta mais recente primeiro para preservar o encadeamento do historico.',
        'HAS_LATER_COLLECTION'
      );
    }

    const cancelledAt = nowForDb();
    const affected = await collectionRepository.cancel(conn, id, {
      userId: user.id, reason: trimmed, cancelledAt, accountId: conta
    });
    if (!affected) throw AppError.conflict('Nao foi possivel cancelar esta coleta.', 'CANCEL_FAILED');

    await auditService.log({
      conn,
      accountId: conta,
      userId: user.id,
      entity: 'collection',
      entityId: Number(id),
      action: 'cancel',
      oldValues: {
        status: 'confirmed',
        calculated_total_value: money.normalize(collection.calculated_total_value)
      },
      newValues: { status: 'cancelled', cancelled_at: cancelledAt },
      reason: trimmed,
      req
    });

    return getDetail(id, conta, conn);
  });
}

module.exports = { getLastReading, createCollection, getDetail, cancelCollection };
