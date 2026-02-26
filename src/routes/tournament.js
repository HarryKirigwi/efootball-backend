import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/config', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT `key`, value_json FROM tournament_config WHERE `key` IN (?, ?, ?, ?)',
      ['tournament_status', 'tournament_name', 'start_date', 'max_matches_per_day']
    );
    const config = {};
    result.rows.forEach((r) => {
      config[r.key] = r.value_json;
    });
    res.json({
      tournament_status: config.tournament_status ?? 'not_started',
      tournament_name: config.tournament_name ?? 'Machakos University Efootball Tournament',
      start_date: config.start_date ?? null,
      max_matches_per_day: config.max_matches_per_day ? Number(config.max_matches_per_day) : null,
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/tournament/config - update tournament configuration (super_admin only)
// Supports { tournament_status, start_date, max_matches_per_day }.
router.patch('/config', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { tournament_status, start_date, max_matches_per_day } = req.body || {};

    if (tournament_status !== undefined) {
      const allowed = ['not_started', 'started'];
      if (!allowed.includes(tournament_status)) {
        return res.status(400).json({ error: `tournament_status must be one of: ${allowed.join(', ')}` });
      }

      await query(
        `INSERT INTO tournament_config (id, \`key\`, value_json)
         VALUES (UUID(), 'tournament_status', JSON_QUOTE(?))
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
        [tournament_status]
      );
    }

    if (start_date !== undefined) {
      await query(
        `INSERT INTO tournament_config (id, \`key\`, value_json)
         VALUES (UUID(), 'start_date', JSON_QUOTE(?))
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
        [start_date || null]
      );
    }

    if (max_matches_per_day !== undefined) {
      const num = Number(max_matches_per_day);
      if (!Number.isFinite(num) || num <= 0) {
        return res
          .status(400)
          .json({ error: 'max_matches_per_day must be a positive number' });
      }
      await query(
        `INSERT INTO tournament_config (id, \`key\`, value_json)
         VALUES (UUID(), 'max_matches_per_day', JSON_QUOTE(?))
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
        [String(num)]
      );
    }

    // Return updated config
    const result = await query(
      'SELECT `key`, value_json FROM tournament_config WHERE `key` IN (?, ?, ?, ?)',
      ['tournament_status', 'tournament_name', 'start_date', 'max_matches_per_day']
    );
    const config = {};
    result.rows.forEach((r) => {
      config[r.key] = r.value_json;
    });
    res.json({
      tournament_status: config.tournament_status ?? 'not_started',
      tournament_name: config.tournament_name ?? 'Machakos University Efootball Tournament',
      start_date: config.start_date ?? null,
      max_matches_per_day: config.max_matches_per_day ? Number(config.max_matches_per_day) : null,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
