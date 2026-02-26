-- Additive migration for matches and rounds to support fixtures overhaul
-- Matches: add venue, match_title, published
-- Rounds: add status, released

ALTER TABLE matches
  ADD COLUMN venue VARCHAR(255) NULL,
  ADD COLUMN match_title VARCHAR(200) NULL,
  ADD COLUMN published TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE rounds
  ADD COLUMN status ENUM('upcoming', 'in_progress', 'completed') NOT NULL DEFAULT 'upcoming',
  ADD COLUMN released TINYINT(1) NOT NULL DEFAULT 0;

