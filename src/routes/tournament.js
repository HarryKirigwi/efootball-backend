import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

router.get('/config', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT `key`, value_json FROM tournament_config WHERE `key` IN (?, ?)',
      ['tournament_status', 'tournament_name']
    );
    const config = {};
    result.rows.forEach((r) => { config[r.key] = r.value_json; });
    res.json({
      tournament_status: config.tournament_status ?? 'not_started',
      tournament_name: config.tournament_name ?? 'Machakos University Efootball Tournament',
    });
  } catch (e) {
    next(e);
  }
});

export default router;
