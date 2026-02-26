import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { seedRound1, getMatchesByRound, createRound } from '../services/bracketService.js';

const router = Router();

async function enrichMatchesForBracket(rows) {
  if (rows.length === 0) return rows;
  const participantIds = new Set();
  for (const r of rows) {
    if (r.participant_home_id) participantIds.add(r.participant_home_id);
    if (r.participant_away_id) participantIds.add(r.participant_away_id);
  }
  const ids = [...participantIds];
  if (ids.length === 0) return rows;
  const placeholders = ids.map(() => '?').join(',');
  const partResult = await query(
    `SELECT id, full_name, efootball_username FROM participants WHERE id IN (${placeholders})`,
    ids
  );
  const byId = Object.fromEntries(partResult.rows.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    home_name: r.participant_home_id ? (byId[r.participant_home_id]?.full_name || byId[r.participant_home_id]?.efootball_username || 'TBD') : 'TBD',
    away_name: r.participant_away_id ? (byId[r.participant_away_id]?.full_name || byId[r.participant_away_id]?.efootball_username || 'TBD') : 'TBD',
  }));
}

/**
 * GET /api/rounds - list rounds with match counts and status
 */
router.get('/rounds', async (req, res, next) => {
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
       ORDER BY r.round_number ASC`
    );
    res.json({ rounds: result.rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/bracket - tree/list of matches by round (for display)
 */
router.get('/bracket', async (req, res, next) => {
  try {
    const roundsResult = await query(
      'SELECT id, round_number, name, total_matches FROM rounds ORDER BY round_number ASC'
    );
    const rounds = roundsResult.rows;
    const byRound = [];
    for (const r of rounds) {
      const matches = await getMatchesByRound(r.id);
      const enriched = await enrichMatchesForBracket(matches);
      byRound.push({ round: r, matches: enriched });
    }
    res.json({ bracket: byRound });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/rounds - create a round (super_admin)
 * Body: { name, round_number, total_matches, start_date?, end_date? }
 */
router.post('/rounds', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { name, round_number, total_matches, start_date, end_date } = req.body || {};
    if (!name || !round_number || !total_matches) {
      return res.status(400).json({ error: 'name, round_number and total_matches are required' });
    }
    const roundId = await createRound(
      Number(round_number),
      name,
      Number(total_matches),
      start_date || null,
      end_date || null
    );
    const result = await query(
      `SELECT id, round_number, name, total_matches, start_date, end_date, status, released
       FROM rounds WHERE id = ?`,
      [roundId]
    );
    res.status(201).json({ round: result.rows[0] });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/rounds/:id - update round (status, released, metadata) (super_admin)
 * Enforces: released can only be set when previous round (by round_number) is completed.
 */
router.patch('/rounds/:id', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      round_number,
      total_matches,
      start_date,
      end_date,
      status,
      released,
    } = req.body || {};

    const currentResult = await query(
      'SELECT id, round_number, status, released FROM rounds WHERE id = ?',
      [id]
    );
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found' });
    }
    const current = currentResult.rows[0];

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (round_number !== undefined) {
      updates.push('round_number = ?');
      values.push(Number(round_number));
    }
    if (total_matches !== undefined) {
      updates.push('total_matches = ?');
      values.push(Number(total_matches));
    }
    if (start_date !== undefined) {
      updates.push('start_date = ?');
      values.push(start_date || null);
    }
    if (end_date !== undefined) {
      updates.push('end_date = ?');
      values.push(end_date || null);
    }
    if (status !== undefined) {
      const allowedStatus = ['upcoming', 'in_progress', 'completed'];
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowedStatus.join(', ')}` });
      }
      updates.push('status = ?');
      values.push(status);
    }
    if (released !== undefined) {
      const releasing = released ? 1 : 0;
      if (releasing && !current.released) {
        const prevRoundNumber = current.round_number - 1;
        if (prevRoundNumber > 0) {
          const prevResult = await query(
            'SELECT status FROM rounds WHERE round_number = ? ORDER BY created_at DESC LIMIT 1',
            [prevRoundNumber]
          );
          const prev = prevResult.rows[0];
          if (prev && prev.status !== 'completed') {
            return res
              .status(400)
              .json({ error: 'Previous round must be completed before releasing this round' });
          }
        }
      }
      updates.push('released = ?');
      values.push(releasing);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id);
    await query(
      `UPDATE rounds
       SET ${updates.join(', ')}
       WHERE id = ?`,
      values
    );

    const result = await query(
      `SELECT id, round_number, name, total_matches, start_date, end_date, status, released
       FROM rounds WHERE id = ?`,
      [id]
    );

    res.json({ round: result.rows[0] });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/bracket/seed - super_admin only: seed round 1 from ranked participants.
 * Body: { tournament_start_date: "YYYY-MM-DD" }
 */
router.post('/bracket/seed', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { tournament_start_date } = req.body;
    const startDate = tournament_start_date ? new Date(tournament_start_date) : new Date();
    const result = await seedRound1(startDate);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
