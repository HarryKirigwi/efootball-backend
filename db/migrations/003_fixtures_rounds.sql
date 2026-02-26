-- Additive migration for fixtures and rounds metadata
-- - matches: venue, match_title, published flag, optional parent_match_id
-- - rounds: status, released flag

ALTER TABLE matches
  ADD COLUMN match_title VARCHAR(200) NULL AFTER away_possession,
  ADD COLUMN venue VARCHAR(255) NULL AFTER match_title,
  ADD COLUMN published TINYINT(1) NOT NULL DEFAULT 0 AFTER venue,
  ADD COLUMN parent_match_id CHAR(36) NULL AFTER published,
  ADD KEY idx_matches_published (published),
  ADD KEY idx_matches_parent_match_id (parent_match_id),
  ADD CONSTRAINT fk_matches_parent_match
    FOREIGN KEY (parent_match_id) REFERENCES matches(id)
    ON DELETE SET NULL;

ALTER TABLE rounds
  ADD COLUMN status ENUM('upcoming', 'in_progress', 'completed') NOT NULL DEFAULT 'upcoming' AFTER end_date,
  ADD COLUMN released TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD KEY idx_rounds_status (status),
  ADD KEY idx_rounds_released (released);

