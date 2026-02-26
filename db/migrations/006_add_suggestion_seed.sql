-- Add suggestion_seed to rounds so suggested pairings are stable (same on reload)

ALTER TABLE rounds
  ADD COLUMN suggestion_seed BIGINT NULL AFTER released;
