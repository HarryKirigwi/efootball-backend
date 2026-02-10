-- Machakos University Efootball Tournament - Full schema (MySQL)
-- Run this against your MySQL database (e.g. mysql -u root -p efootball < db/migrations/001_initial.sql)

-- Users (all account types: super_admin, admin, participant)
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  full_name VARCHAR(255) NOT NULL,
  efootball_username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'admin', 'participant') NOT NULL DEFAULT 'participant',
  avatar_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_efootball_username (efootball_username),
  KEY idx_users_role (role)
);

-- Participants (created only after payment verification)
CREATE TABLE participants (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  efootball_username VARCHAR(100) NOT NULL,
  avg_pass_accuracy DECIMAL(5,2) NULL,
  avg_possession DECIMAL(5,2) NULL,
  eliminated TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_participants_user_id (user_id),
  KEY idx_participants_user_id (user_id),
  KEY idx_participants_eliminated (eliminated),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Admins (optional tracking; role is on users)
CREATE TABLE admins (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  created_by_super_admin_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admins_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_super_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Payments (registration fee; manual verification)
CREATE TABLE payments (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  amount INT NOT NULL,
  mpesa_transaction_code VARCHAR(50) NOT NULL,
  status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  verified_by_super_admin_id CHAR(36) NULL,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_payments_status (status),
  KEY idx_payments_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by_super_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Tournament config (key-value: status, times, etc.)
CREATE TABLE tournament_config (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  `key` VARCHAR(100) NOT NULL,
  value_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tournament_config_key (`key`)
);

-- Rounds
CREATE TABLE rounds (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  round_number INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  total_matches INT NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Matches
CREATE TABLE matches (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  round_id CHAR(36) NULL,
  participant_home_id CHAR(36) NULL,
  participant_away_id CHAR(36) NULL,
  scheduled_at DATETIME NULL,
  status ENUM('scheduled', 'ongoing', 'completed') NOT NULL DEFAULT 'scheduled',
  home_goals INT DEFAULT 0,
  away_goals INT DEFAULT 0,
  home_pass_accuracy DECIMAL(5,2) NULL,
  away_pass_accuracy DECIMAL(5,2) NULL,
  home_possession DECIMAL(5,2) NULL,
  away_possession DECIMAL(5,2) NULL,
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  admin_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_matches_status (status),
  KEY idx_matches_scheduled_at (scheduled_at),
  KEY idx_matches_round_id (round_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL,
  FOREIGN KEY (participant_home_id) REFERENCES participants(id) ON DELETE SET NULL,
  FOREIGN KEY (participant_away_id) REFERENCES participants(id) ON DELETE SET NULL,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Match events (live goal feed)
CREATE TABLE match_events (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  match_id CHAR(36) NOT NULL,
  participant_id CHAR(36) NULL,
  event_type VARCHAR(50) NOT NULL,
  minute INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_match_events_match_id (match_id),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
);

-- Seed default tournament config (ignore if key exists)
INSERT INTO tournament_config (`key`, value_json) VALUES
  ('tournament_status', '"not_started"'),
  ('tournament_name', '"Machakos University Efootball Tournament"')
ON DUPLICATE KEY UPDATE `key` = `key`;
