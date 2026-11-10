-- DietDigiDose initial migration
-- Create users table
--
-- Note: dev/test environments use GORM AutoMigrate; this file is for prod manual migrations.
-- Usage: ./scripts/migrate.sh up

CREATE TABLE IF NOT EXISTS `users` (
    `id`            BIGINT UNSIGNED NOT NULL,           -- snowflake ID (no auto-increment)
    `username`      VARCHAR(50)  NOT NULL DEFAULT '',
    `email`         VARCHAR(200) NOT NULL DEFAULT '',
    `phone`         VARCHAR(20)  NOT NULL DEFAULT '',
    `password`      VARCHAR(255) NOT NULL DEFAULT '',   -- Argon2id/bcrypt hash
    `avatar`        VARCHAR(500) NOT NULL DEFAULT '',
    `role`          VARCHAR(20)  NOT NULL DEFAULT 'user',
    `status`        TINYINT      NOT NULL DEFAULT 1,     -- 1=active, 0=disabled
    `last_login_at` BIGINT       NULL,                   -- unix timestamp
    `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at`    DATETIME     NULL,
    `create_by`     VARCHAR(128) NOT NULL DEFAULT '',
    `update_by`     VARCHAR(128) NOT NULL DEFAULT '',
    `remark`        VARCHAR(128) NOT NULL DEFAULT '',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    UNIQUE KEY `uk_email` (`email`),
    KEY `idx_deleted_at` (`deleted_at`),
    KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
