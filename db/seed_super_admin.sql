-- Seed Migichi super admin account
-- Run this once against your MySQL `efootball` database.
-- Password: Sp@xx1fy (bcrypt-hashed below)

INSERT INTO users (full_name, reg_no, efootball_username, password_hash, role, avatar_url, created_at, updated_at)
VALUES (
  'Migichi Admin',
  'ADMIN-0000',
  'migichi47',
  '$2b$10$SpDUCA3lEdPQuUCKqB4ipuvzd7Y6L3HhvjfMFMcrotOn2UzbcH1Hi',
  'super_admin',
  NULL,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  role = 'super_admin',
  updated_at = NOW();

