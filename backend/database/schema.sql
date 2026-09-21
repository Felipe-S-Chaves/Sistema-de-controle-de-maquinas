-- =====================================================================
-- SISTEMA DE CONTROLE DE MAQUINAS DE MUSICA
-- Schema relacional normalizado - MySQL 8 / MariaDB 10.4+
-- Valores monetarios: DECIMAL(14,2) (nunca FLOAT)
--
-- SEPARACAO POR CONTA
-- Cada conta e um sistema fechado: clientes, maquinas, coletas, usuarios e
-- auditoria pertencem a uma conta e nunca atravessam para a outra. Toda
-- tabela de dado do negocio carrega account_id, e as chaves unicas que antes
-- valiam para o sistema inteiro passaram a valer DENTRO de cada conta - duas
-- contas podem ter a maquina "001" e o mesmo CPF sem colidir.
-- =====================================================================

-- ---------------------------------------------------------------------
-- accounts (contas) - a fronteira de isolamento do sistema
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,
  status      ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id     INT UNSIGNED  NOT NULL,
  name           VARCHAR(150)  NOT NULL,
  email          VARCHAR(190)  NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  role           ENUM('admin','operator') NOT NULL DEFAULT 'operator',
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active'
                 COMMENT 'Contas criadas pelo auto-cadastro nascem inactive ate o admin liberar',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0
                 COMMENT 'Senha temporaria: o sistema exige a troca no primeiro acesso',
  last_login_at  DATETIME      NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- O e-mail e a identidade de login, entao continua unico no sistema todo:
  -- duas pessoas em contas diferentes nao podem disputar o mesmo endereco.
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_status (status),
  KEY idx_users_account (account_id),
  CONSTRAINT fk_users_account FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- owners (proprietarios) - NAO existe entidade "estabelecimento"
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owners (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id     INT UNSIGNED  NOT NULL,
  name           VARCHAR(180)  NOT NULL,
  document       VARCHAR(18)   NULL COMMENT 'CPF/CNPJ somente digitos',
  document_type  ENUM('cpf','cnpj') NULL,
  phone          VARCHAR(20)   NULL,
  whatsapp       VARCHAR(20)   NULL,
  email          VARCHAR(190)  NULL,
  address        VARCHAR(255)  NULL,
  city           VARCHAR(120)  NULL,
  state          CHAR(2)       NULL,
  zip_code       VARCHAR(9)    NULL,
  notes          TEXT          NULL,

  -- Foto do documento do cliente. Uma por cliente, arquivo em disco e
  -- metadados aqui - o mesmo desenho usado nas fotos de coleta.
  document_photo_path     VARCHAR(255) NULL COMMENT 'Caminho relativo dentro de uploads/',
  document_photo_name     VARCHAR(255) NULL,
  document_photo_mime     VARCHAR(100) NULL,
  document_photo_size     INT UNSIGNED NULL,
  document_photo_checksum CHAR(64)     NULL COMMENT 'SHA-256 do arquivo',
  document_photo_at       DATETIME     NULL,

  status         ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_by     INT UNSIGNED  NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Unico DENTRO da conta: o mesmo CPF pode ser cliente das duas.
  UNIQUE KEY uq_owners_account_document (account_id, document),
  KEY idx_owners_name (name),
  KEY idx_owners_status (status),
  KEY idx_owners_account (account_id),
  CONSTRAINT fk_owners_account FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_owners_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- machines - pertence DIRETAMENTE a um proprietario
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machines (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id        INT UNSIGNED  NOT NULL,
  number            VARCHAR(20)   NOT NULL COMMENT 'Numero identificador, unico dentro da conta',
  name              VARCHAR(150)  NOT NULL,
  owner_id          INT UNSIGNED  NOT NULL,
  model             VARCHAR(120)  NULL,
  manufacturer      VARCHAR(120)  NULL,
  serial_number     VARCHAR(120)  NULL,
  installation_date DATE          NULL,
  status            ENUM('active','maintenance') NOT NULL DEFAULT 'active',
  notes             TEXT          NULL,
  created_by        INT UNSIGNED  NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Unico DENTRO da conta: as duas podem ter uma maquina "001".
  UNIQUE KEY uq_machines_account_number (account_id, number),
  KEY idx_machines_owner (owner_id),
  KEY idx_machines_status (status),
  KEY idx_machines_name (name),
  KEY idx_machines_account (account_id),
  CONSTRAINT fk_machines_account FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_machines_owner FOREIGN KEY (owner_id) REFERENCES owners (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_machines_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- collections (coletas / leituras)
-- Cada coleta e um registro NOVO. Historico nunca e sobrescrito.
-- calculated_* sao SEMPRE recalculados pelo backend.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id                     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  account_id             INT UNSIGNED  NOT NULL,
  machine_id             INT UNSIGNED  NOT NULL,
  owner_id               INT UNSIGNED  NOT NULL COMMENT 'Snapshot do dono no momento da coleta',
  user_id                INT UNSIGNED  NOT NULL COMMENT 'Usuario responsavel',

  previous_entry_value   DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  current_entry_value    DECIMAL(14,2) NOT NULL,
  calculated_entry_value DECIMAL(14,2) NOT NULL,

  previous_exit_value    DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  current_exit_value     DECIMAL(14,2) NOT NULL,
  calculated_exit_value  DECIMAL(14,2) NOT NULL,

  calculated_total_value DECIMAL(14,2) NOT NULL,

  is_first_collection    TINYINT(1)    NOT NULL DEFAULT 0,
  is_exception           TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Leitura menor que a anterior confirmada',
  exception_reason       TEXT          NULL,

  observation            TEXT          NULL,
  status                 ENUM('confirmed','cancelled') NOT NULL DEFAULT 'confirmed',

  collected_at           DATETIME      NOT NULL,
  timezone               VARCHAR(64)   NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  cancelled_at           DATETIME      NULL,
  cancelled_by           INT UNSIGNED  NULL,
  cancellation_reason    TEXT          NULL,

  PRIMARY KEY (id),
  KEY idx_collections_machine_date (machine_id, collected_at),
  KEY idx_collections_owner_date (owner_id, collected_at),
  KEY idx_collections_status_date (status, collected_at),
  KEY idx_collections_user (user_id),
  KEY idx_collections_machine_status_id (machine_id, status, id),
  KEY idx_collections_account_date (account_id, collected_at),
  CONSTRAINT fk_collections_account FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_collections_machine FOREIGN KEY (machine_id) REFERENCES machines (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_collections_owner FOREIGN KEY (owner_id) REFERENCES owners (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_collections_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_collections_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_collections_entry CHECK (current_entry_value >= 0),
  CONSTRAINT chk_collections_exit CHECK (current_exit_value >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- collection_images (comprovantes) - arquivo em disco, metadados no banco
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_images (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  collection_id  INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NULL,
  file_path      VARCHAR(255) NOT NULL COMMENT 'Caminho relativo dentro de uploads/',
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  checksum       CHAR(64)     NULL COMMENT 'SHA-256 do arquivo',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_collection_images_collection (collection_id),
  CONSTRAINT fk_collection_images_collection FOREIGN KEY (collection_id) REFERENCES collections (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_collection_images_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- audit_logs - nunca ha exclusao silenciosa de dado financeiro
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id  INT UNSIGNED    NULL COMMENT 'NULL apenas em eventos de sistema, fora de qualquer conta',
  user_id     INT UNSIGNED    NULL,
  entity      VARCHAR(60)     NOT NULL COMMENT 'owner | machine | collection | user | auth',
  entity_id   INT UNSIGNED    NULL,
  action      VARCHAR(60)     NOT NULL COMMENT 'create | update | cancel | login | exception ...',
  old_values  JSON            NULL,
  new_values  JSON            NULL,
  reason      TEXT            NULL,
  ip_address  VARCHAR(64)     NULL,
  user_agent  VARCHAR(255)    NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity, entity_id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_user (user_id),
  KEY idx_audit_account (account_id, id),
  CONSTRAINT fk_audit_account FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- machine_transfers - preparado para evolucao futura (nao usado no MVP)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_transfers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id      INT UNSIGNED NOT NULL,
  from_owner_id   INT UNSIGNED NOT NULL,
  to_owner_id     INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NULL,
  reason          TEXT         NULL,
  transferred_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transfers_machine (machine_id),
  CONSTRAINT fk_transfers_machine FOREIGN KEY (machine_id) REFERENCES machines (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_transfers_from FOREIGN KEY (from_owner_id) REFERENCES owners (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_to FOREIGN KEY (to_owner_id) REFERENCES owners (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- machine_revenue_splits - preparado para divisao financeira futura
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_revenue_splits (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_id        INT UNSIGNED NOT NULL,
  owner_percentage  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  company_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  valid_from        DATE         NOT NULL,
  valid_to          DATE         NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_splits_machine (machine_id),
  CONSTRAINT fk_splits_machine FOREIGN KEY (machine_id) REFERENCES machines (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
