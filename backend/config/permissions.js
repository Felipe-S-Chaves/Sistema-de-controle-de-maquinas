'use strict';

/**
 * Perfis de acesso do sistema.
 *
 * ADMINISTRADOR (admin)
 *   Acesso total: gestao, edicao, cancelamento, relatorios, PDF, auditoria
 *   e gerenciamento de usuarios.
 *
 * OPERADOR (operator)
 *   Trabalha em campo. Pode CADASTRAR clientes e maquinas e REGISTRAR
 *   coletas. Nao edita nada depois de criado, nao cancela, nao ve relatorios
 *   nem auditoria.
 *   Ve o valor apurado das coletas que ele proprio registrou - e nada alem
 *   disso: nenhum total do negocio, nenhuma coleta de outro usuario.
 *
 * Sao apenas estes dois perfis. Cada usuario tem UM deles.
 *
 * Esta tabela e a fonte unica da verdade. O frontend esconde botoes com base
 * nela, mas quem decide de fato e o backend.
 */

const PERMISSOES = {
  // Clientes
  'owners.view': ['admin'],
  'owners.create': ['admin', 'operator'],
  'owners.update': ['admin'],
  'owners.delete': ['admin'],

  // Maquinas
  'machines.view': ['admin'],
  'machines.create': ['admin', 'operator'],
  'machines.update': ['admin'],
  'machines.delete': ['admin'],

  // Coletas
  'collections.create': ['admin', 'operator'],
  'collections.viewAll': ['admin'],
  'collections.viewOwn': ['admin', 'operator'],
  'collections.cancel': ['admin'],

  // Comprovante de uma coleta e relatorio das PROPRIAS coletas.
  // O operador leva o comprovante ao cliente e presta contas do
  // proprio trabalho, sem enxergar o movimento de outras pessoas.
  'collections.receipt': ['admin', 'operator'],
  'reports.own': ['admin', 'operator'],

  // Gestao
  'dashboard.full': ['admin'],
  'reports.view': ['admin'],
  'audit.view': ['admin'],
  'users.manage': ['admin'],
  'users.delete': ['admin']
};

/** O papel informado tem a permissao? */
function pode(role, permissao) {
  const papeis = PERMISSOES[permissao];
  return Array.isArray(papeis) && papeis.includes(role);
}

/** Lista de permissoes de um papel - enviada ao frontend apos o login. */
function permissoesDoPapel(role) {
  return Object.keys(PERMISSOES).filter((chave) => pode(role, chave));
}

const PAPEIS = {
  admin: 'Administrador',
  operator: 'Operador'
};

module.exports = { PERMISSOES, PAPEIS, pode, permissoesDoPapel };
