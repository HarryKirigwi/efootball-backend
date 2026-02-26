import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// #region agent log
const LOG_PATH = path.join(process.cwd(), '..', 'debug-232373.log');
const DEBUG_LOG = (location, message, data, hypothesisId) => {
  try {
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({
        sessionId: '232373',
        location,
        message,
        data: { ...data, hypothesisId },
        timestamp: Date.now(),
      }) + '\n'
    );
  } catch {
    // swallow logging errors
  }
};
// #endregion

// GET /api/rounds - list rounds with optional match counts
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id,
              r.round_number,
              r.name,
              r.total_matches,
              r.start_date,
              r.end_date,
              r.status,
              r.released,
              (SELECT COUNT(*) FROM matches m WHERE m.round_id = r.id) AS match_count
       FROM rounds r
       ORDER BY r.round_number ASC, r.created_at ASC`
    );
    res.json({ rounds: result.rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/rounds - create round (super_admin only)
router.post('/', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { name, round_number, total_matches, start_date, end_date } = req.body || {};
    DEBUG_LOG('routes/rounds.js:post', 'create round request', {
      body: { name, round_number, total_matches, start_date, end_date },
      userId: req.user?.id,
    }, 'H1');
    if (!name?.trim() || !round_number) {
      return res.status(400).json({ error: 'name and round_number are required' });
    }
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO rounds (id, round_number, name, total_matches, start_date, end_date, status, released, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming', 0, NOW(), NOW())`,
      [id, Number(round_number), name.trim(), total_matches ?? 0, start_date || null, end_date || null]
    );
    const payload = {
      id,
      name: name.trim(),
      round_number: Number(round_number),
      total_matches: total_matches ?? 0,
      start_date,
      end_date,
      status: 'upcoming',
      released: 0,
    };
    DEBUG_LOG('routes/rounds.js:post', 'create round success', payload, 'H1');
    res.status(201).json(payload);
  } catch (e) {
    DEBUG_LOG(
      'routes/rounds.js:post',
      'create round error',
      { error: e.message || String(e) },
      'H1'
    );
    next(e);
  }
});

// PATCH /api/rounds/:id - update name / status / released (super_admin only)
router.patch('/:id', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, status, released } = req.body || {};

    const currentResult = await query(
      'SELECT id, round_number, status, released FROM rounds WHERE id = ?',
      [id]
    );
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found' });
    }
    const current = currentResult.rows[0];

    const updates = [];
    const params = [];

    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
      updates.push('name = ?');
      params.push(trimmed);
    }

    if (status) {
      const allowed = ['upcoming', 'in_progress', 'completed'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      }
      updates.push('status = ?');
      params.push(status);
    }

    if (released !== undefined) {
      const releaseFlag = released ? 1 : 0;
      if (releaseFlag && !current.released) {
        // Enforce rule: can only release this round if previous round (by number) is completed.
        const prevNumber = (current.round_number || 0) - 1;
        if (prevNumber > 0) {
          const prevResult = await query(
            'SELECT status FROM rounds WHERE round_number = ? ORDER BY created_at ASC LIMIT 1',
            [prevNumber]
          );
          const prev = prevResult.rows[0];
          if (!prev || prev.status !== 'completed') {
            return res
              .status(400)
              .json({ error: 'Previous round must be completed before releasing this round' });
          }
        }
      }
      updates.push('released = ?');
      params.push(releaseFlag);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    params.push(id);
    await query(
      `UPDATE rounds SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    const updatedResult = await query(
      'SELECT id, round_number, name, total_matches, start_date, end_date, status, released FROM rounds WHERE id = ?',
      [id]
    );
    res.json(updatedResult.rows[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/rounds/:id - delete a round with no matches (super_admin only)
router.delete('/:id', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const exists = await query('SELECT id FROM rounds WHERE id = ?', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found' });
    }

    const matchesResult = await query('SELECT COUNT(*) AS cnt FROM matches WHERE round_id = ?', [id]);
    const count = Number(matchesResult.rows[0]?.cnt || 0);
    if (count > 0) {
      return res
        .status(400)
        .json({ error: 'Cannot delete a round that already has matches. Delete matches first.' });
    }

    await query('DELETE FROM rounds WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;

