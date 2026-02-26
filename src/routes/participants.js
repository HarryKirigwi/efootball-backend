import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/participants/active - list all active participants (verified, not eliminated)
router.get('/active', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id,
              user_id,
              full_name,
              efootball_username,
              avg_pass_accuracy,
              avg_possession,
              eliminated,
              created_at
       FROM participants
       WHERE eliminated = 0
       ORDER BY full_name ASC, created_at ASC`
    );
    res.json({ participants: result.rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/participants/:id/eliminate - mark a participant as eliminated
router.post('/:id/eliminate', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await query('SELECT id, eliminated FROM participants WHERE id = ?', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    if (existing.rows[0].eliminated) {
      return res.json({ ok: true });
    }

    await query('UPDATE participants SET eliminated = 1 WHERE id = ?', [id]);

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;

