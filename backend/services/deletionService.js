'use strict';

/**
 * Exclusao de clientes, maquinas e usuarios.
 *
 * REGRA CENTRAL
 * Registro sem nenhuma coleta pode ser apagado a vontade: nao ha historico
 * financeiro em jogo.
 *
 * Registro COM coletas nunca e apagado por acidente. A rota responde 409 com
 * o resumo do que seria destruido, e so apaga quando o administrador confirma
 * explicitamente (cascade = true). A interface usa esse 409 para oferecer as
 * duas saidas: desativar ou apagar tudo.
 *
 * POR QUE O USUARIO E DIFERENTE
 * As coletas de um usuario pertencem ao negocio, nao a ele. Apagar um usuario
 * levando as coletas junto abriria buracos no encadeamento das maquinas: a
 * coleta seguinte guarda como "leitura anterior" o valor da coleta apagada,
 * e os numeros deixariam de fechar. Por isso usuario com coletas nunca e
 * apagado - so desativado.
 */

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const auditService = require('./auditService');
const { exigirConta } = require('../utils/tenant');

/** Resumo do que existe amarrado a um cliente. */
async function resumoDoCliente(ownerId, accountId) {
  const linha = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM machines m WHERE m.owner_id = o.id) AS maquinas,
       (SELECT COUNT(*) FROM collections c WHERE c.owner_id = o.id) AS coletas,
       (SELECT COALESCE(SUM(c.calculated_total_value), 0) FROM collections c
         WHERE c.owner_id = o.id AND c.status = 'confirmed') AS total,
       (SELECT COUNT(*) FROM collection_images ci
          JOIN collections c2 ON c2.id = ci.collection_id
         WHERE c2.owner_id = o.id) AS fotos
     FROM owners o WHERE o.id = ? AND o.account_id = ?`,
    [ownerId, exigirConta(accountId)]
  );
  if (!linha) return null;
  return {
    maquinas: Number(linha.maquinas),
    coletas: Number(linha.coletas),
    fotos: Number(linha.fotos),
    total: linha.total
  };
}

/** Resumo do que existe amarrado a uma maquina. */
async function resumoDaMaquina(machineId, accountId) {
  const linha = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM collections c WHERE c.machine_id = m.id) AS coletas,
       (SELECT COALESCE(SUM(c.calculated_total_value), 0) FROM collections c
         WHERE c.machine_id = m.id AND c.status = 'confirmed') AS total,
       (SELECT COUNT(*) FROM collection_images ci
          JOIN collections c2 ON c2.id = ci.collection_id
         WHERE c2.machine_id = m.id) AS fotos
     FROM machines m WHERE m.id = ? AND m.account_id = ?`,
    [machineId, exigirConta(accountId)]
  );
  if (!linha) return null;
  return { coletas: Number(linha.coletas), fotos: Number(linha.fotos), total: linha.total };
}

/** Caminhos das fotos que serao removidas junto. */
async function caminhosDasFotos(conn, campo, valor) {
  const [linhas] = await conn.execute(
    `SELECT ci.file_path
       FROM collection_images ci
       JOIN collections c ON c.id = ci.collection_id
      WHERE c.${campo} = ?`,
    [valor]
  );
  return linhas.map((l) => l.file_path);
}

/** Remove os arquivos do disco. Falha aqui nao desfaz a exclusao no banco. */
function apagarArquivos(caminhos) {
  for (const relativo of caminhos) {
    const absoluto = path.resolve(config.uploads.dir, relativo);
    const raiz = path.resolve(config.uploads.dir);
    if (!absoluto.startsWith(raiz + path.sep)) continue;   // defesa contra path traversal
    fs.promises.unlink(absoluto).catch(() => { /* arquivo ja removido */ });
  }
}

/** Erro 409 que a interface usa para oferecer desativar ou apagar tudo. */
function exigirConfirmacao(tipo, nome, resumo) {
  const partes = [];
  if (resumo.maquinas) partes.push(`${resumo.maquinas} maquina(s)`);
  if (resumo.coletas) partes.push(`${resumo.coletas} coleta(s)`);
  if (resumo.fotos) partes.push(`${resumo.fotos} foto(s)`);

  return new AppError(
    `"${nome}" possui historico: ${partes.join(', ')}. ` +
    'Apagar remove esse historico financeiro em definitivo.',
    409,
    'HAS_HISTORY',
    { tipo, nome, ...resumo }
  );
}

// --------------------------------------------------------------------
// Cliente
// --------------------------------------------------------------------
async function removerCliente({ id, cascade, user, req }) {
  const conta = exigirConta(user.account_id);
  const owner = await db.queryOne(
    'SELECT * FROM owners WHERE id = ? AND account_id = ?', [id, conta]
  );
  if (!owner) throw AppError.notFound('Cliente nao encontrado.');

  const resumo = await resumoDoCliente(id, conta);
  const temHistorico = resumo.maquinas > 0 || resumo.coletas > 0;

  if (temHistorico && !cascade) throw exigirConfirmacao('owner', owner.name, resumo);

  return db.transaction(async (conn) => {
    let fotos = [];

    if (temHistorico) {
      fotos = await caminhosDasFotos(conn, 'owner_id', id);
      // A ordem importa: imagens -> coletas -> maquinas -> cliente.
      await conn.execute(
        `DELETE ci FROM collection_images ci
           JOIN collections c ON c.id = ci.collection_id
          WHERE c.owner_id = ?`, [id]
      );
      await conn.execute('DELETE FROM collections WHERE owner_id = ?', [id]);
      await conn.execute('DELETE FROM machine_transfers WHERE from_owner_id = ? OR to_owner_id = ?', [id, id]);
      await conn.execute(
        `DELETE ms FROM machine_revenue_splits ms
           JOIN machines m ON m.id = ms.machine_id
          WHERE m.owner_id = ?`, [id]
      );
      await conn.execute('DELETE FROM machines WHERE owner_id = ?', [id]);
    }

    await conn.execute('DELETE FROM owners WHERE id = ?', [id]);

    await auditService.log({
      conn,
      accountId: conta,
      userId: user.id,
      entity: 'owner',
      entityId: Number(id),
      action: 'delete',
      oldValues: {
        nome: owner.name,
        documento: owner.document,
        maquinas_removidas: resumo.maquinas,
        coletas_removidas: resumo.coletas,
        fotos_removidas: resumo.fotos,
        valor_bruto_removido: resumo.total
      },
      reason: temHistorico ? 'Exclusao com historico, confirmada pelo administrador.' : null,
      req
    });

    apagarArquivos(fotos);
    return { nome: owner.name, ...resumo };
  });
}

// --------------------------------------------------------------------
// Maquina
// --------------------------------------------------------------------
async function removerMaquina({ id, cascade, user, req }) {
  const conta = exigirConta(user.account_id);
  const machine = await db.queryOne(
    'SELECT * FROM machines WHERE id = ? AND account_id = ?', [id, conta]
  );
  if (!machine) throw AppError.notFound('Maquina nao encontrada.');

  const resumo = await resumoDaMaquina(id, conta);
  const temHistorico = resumo.coletas > 0;
  const rotulo = `${machine.number} - ${machine.name}`;

  if (temHistorico && !cascade) throw exigirConfirmacao('machine', rotulo, resumo);

  return db.transaction(async (conn) => {
    let fotos = [];

    if (temHistorico) {
      fotos = await caminhosDasFotos(conn, 'machine_id', id);
      await conn.execute(
        `DELETE ci FROM collection_images ci
           JOIN collections c ON c.id = ci.collection_id
          WHERE c.machine_id = ?`, [id]
      );
      await conn.execute('DELETE FROM collections WHERE machine_id = ?', [id]);
    }

    await conn.execute('DELETE FROM machine_transfers WHERE machine_id = ?', [id]);
    await conn.execute('DELETE FROM machine_revenue_splits WHERE machine_id = ?', [id]);
    await conn.execute('DELETE FROM machines WHERE id = ?', [id]);

    await auditService.log({
      conn,
      accountId: conta,
      userId: user.id,
      entity: 'machine',
      entityId: Number(id),
      action: 'delete',
      oldValues: {
        maquina: rotulo,
        cliente_id: machine.owner_id,
        coletas_removidas: resumo.coletas,
        fotos_removidas: resumo.fotos,
        valor_bruto_removido: resumo.total
      },
      reason: temHistorico ? 'Exclusao com historico, confirmada pelo administrador.' : null,
      req
    });

    apagarArquivos(fotos);
    return { nome: rotulo, ...resumo };
  });
}

// --------------------------------------------------------------------
// Usuario
// --------------------------------------------------------------------
async function removerUsuario({ id, user, req }) {
  const conta = exigirConta(user.account_id);
  const alvo = await db.queryOne(
    'SELECT id, name, email, role, status FROM users WHERE id = ? AND account_id = ?',
    [id, conta]
  );
  if (!alvo) throw AppError.notFound('Usuario nao encontrado.');

  if (Number(id) === Number(user.id)) {
    throw AppError.badRequest('Voce nao pode apagar a propria conta.', 'SELF_DELETION');
  }

  const coletas = await db.queryOne(
    'SELECT COUNT(*) AS total FROM collections WHERE user_id = ?', [id]
  );

  if (Number(coletas.total) > 0) {
    throw new AppError(
      `"${alvo.name}" registrou ${coletas.total} coleta(s). Essas coletas pertencem ao negocio e ` +
      'nao podem ser apagadas junto com a conta - removê-las quebraria o encadeamento das leituras ' +
      'das maquinas. Desative a conta: a pessoa perde o acesso e o historico permanece intacto.',
      409,
      'USER_HAS_COLLECTIONS',
      { coletas: Number(coletas.total), nome: alvo.name }
    );
  }

  if (alvo.role === 'admin') {
    const outro = await db.queryOne(
      `SELECT id FROM users
        WHERE account_id = ? AND role = 'admin' AND status = 'active' AND id <> ? LIMIT 1`,
      [conta, id]
    );
    if (!outro) {
      throw AppError.conflict(
        'Este e o unico administrador ativo desta conta. Promova outro usuario antes de apagar este.',
        'LAST_ADMIN'
      );
    }
  }

  await db.query('DELETE FROM users WHERE id = ? AND account_id = ?', [id, conta]);

  await auditService.log({
    accountId: conta,
    userId: user.id,
    entity: 'user',
    entityId: Number(id),
    action: 'delete',
    oldValues: { nome: alvo.name, email: alvo.email, perfil: alvo.role },
    req
  });

  return { nome: alvo.name };
}

module.exports = {
  removerCliente,
  removerMaquina,
  removerUsuario,
  resumoDoCliente,
  resumoDaMaquina
};
