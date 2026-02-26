-- Add updated_at column to rounds to support audit updates

ALTER TABLE rounds
  ADD COLUMN updated_at DATETIME NULL AFTER created_at;

