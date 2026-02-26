import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { tryAdvanceRound } from '../services/bracketService.js';

const router = Router();

// Normalize various datetime formats (including ISO with T/Z) to a MySQL DATETIME string.
// Returns null if the input is falsy or cannot be parsed.
function normalizeDateTimeForMySQL(input) {
  if (!input) return null;
  if (typeof input === 'string' && !input.includes('T') && !input.toUpperCase().endsWith('Z')) {
    return input;
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  const second = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * Enrich match rows with home/away participant usernames (preferred) and names.
 * Exported for bracket route.
 */
export async function enrichMatches(rows) {
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
    `SELECT id, full_name, efootball_username, user_id FROM participants WHERE id IN (${placeholders})`,
    ids
  );
  const byId = Object.fromEntries(partResult.rows.map((p) => [p.id, p]));
  return rows.map((r) => {
    const home = r.participant_home_id ? byId[r.participant_home_id] : null;
    const away = r.participant_away_id ? byId[r.participant_away_id] : null;
    return {
      ...r,
      home_username: home?.efootball_username || null,
      away_username: away?.efootball_username || null,
      home_name: home ? (home.efootball_username || home.full_name || 'TBD') : 'TBD',
      away_name: away ? (away.efootball_username || away.full_name || 'TBD') : 'TBD',
      home_participant_user_id: home?.user_id || null,
      away_participant_user_id: away?.user_id || null,
    };
  });
}

/**
 * GET /api/matches - list matches (public). status=upcoming|ongoing|completed (upcoming = scheduled)
 * Optional query: round_id, published=0|1.
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, round_id, published } = req.query;
    let sql = `SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status,
               m.home_goals, m.away_goals, m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession,
               m.match_title, m.venue, m.published,
               m.started_at, m.ended_at, m.admin_id, m.created_at, m.updated_at
               FROM matches m WHERE 1=1`;
    const params = [];
    if (status === 'upcoming' || status === 'scheduled') {
      sql += ' AND m.status = ?';
      params.push('scheduled');
    } else if (status === 'ongoing') {
      sql += ' AND m.status = ?';
      params.push('ongoing');
    } else if (status === 'completed') {
      sql += ' AND m.status = ?';
      params.push('completed');
    }
    if (round_id) {
      sql += ' AND m.round_id = ?';
      params.push(round_id);
    }
    if (published === '0' || published === '1') {
      sql += ' AND m.published = ?';
      params.push(Number(published));
    }
    sql += ' ORDER BY m.scheduled_at ASC, m.created_at ASC';
    const result = await query(sql, params);
    const enriched = await enrichMatches(result.rows);
    res.json({ matches: enriched });
  } catch (e) {
    next(e);
  }
});

/**
 * Seeded random (mulberry32) for deterministic shuffle so suggestions don't change on reload.
 */
function seededRandom(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(arr, seed) {
  const rng = seededRandom(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * GET /api/matches/suggested - suggested pairings for a round (super_admin only)
 * Uses round.suggestion_seed so the same list is returned on reload (no duplicate pairings in round).
 * Round 1: deterministic shuffle by seed; Round 2+: performance-based.
 */
router.get('/suggested', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { round_id } = req.query;
    if (!round_id) {
      return res.status(400).json({ error: 'round_id is required' });
    }

    let roundResult = await query(
      'SELECT id, round_number, suggestion_seed FROM rounds WHERE id = ?',
      [round_id]
    );
    if (roundResult.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found' });
    }
    const round = roundResult.rows[0];
    let suggestionSeed = round.suggestion_seed;

    if (suggestionSeed == null) {
      suggestionSeed = crypto.randomInt(1, 0x7fffffff);
      await query('UPDATE rounds SET suggestion_seed = ? WHERE id = ?', [suggestionSeed, round_id]);
    }
    const roundNumber = round.round_number ?? 1;

    const assignedResult = await query(
      'SELECT participant_home_id, participant_away_id FROM matches WHERE round_id = ?',
      [round_id]
    );
    const assignedIds = new Set();
    assignedResult.rows.forEach((m) => {
      if (m.participant_home_id) assignedIds.add(m.participant_home_id);
      if (m.participant_away_id) assignedIds.add(m.participant_away_id);
    });

    const participantsResult = await query(
      `SELECT p.id,
              p.user_id,
              p.full_name,
              p.efootball_username,
              COALESCE(p.avg_pass_accuracy, 0) AS avg_pass_accuracy,
              COALESCE(p.avg_possession, 0)     AS avg_possession
       FROM participants p
       WHERE p.eliminated = 0`
    );
    let eligible = participantsResult.rows.filter((p) => !assignedIds.has(p.id));

    if (eligible.length < 2) {
      return res.json({ round_id, round_number: roundNumber, suggestions: [] });
    }

    if (roundNumber === 1) {
      eligible = shuffleWithSeed(eligible, Number(suggestionSeed));
    } else {
      eligible = [...eligible].sort((a, b) => {
        if (b.avg_pass_accuracy !== a.avg_pass_accuracy) {
          return b.avg_pass_accuracy - a.avg_pass_accuracy;
        }
        return b.avg_possession - a.avg_possession;
      });
    }

    const suggestions = [];
    for (let i = 0; i < eligible.length - 1; i += 2) {
      const home = eligible[i];
      const away = eligible[i + 1];
      suggestions.push({
        round_id,
        home_participant_id: home.id,
        away_participant_id: away.id,
        home_username: home.efootball_username,
        away_username: away.efootball_username,
        home_name: home.full_name,
        away_name: away.full_name,
      });
    }

    res.json({ round_id, round_number: roundNumber, suggestions });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/matches/:id - get one match (auth optional; admins need it)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status,
       m.home_goals, m.away_goals, m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession,
       m.match_title, m.venue, m.published,
       m.started_at, m.ended_at, m.admin_id, m.created_at, m.updated_at
       FROM matches m WHERE m.id = ?`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    const enriched = await enrichMatches(result.rows);
    res.json(enriched[0]);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/matches - create match (super_admin)
 */
router.post('/', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const {
      round_id,
      participant_home_id,
      participant_away_id,
      match_title,
      venue,
      scheduled_at,
      published,
    } = req.body || {};

    // Prevent creating fixtures in completed (past) rounds
    let roundId = round_id || null;
    if (roundId) {
      const roundResult = await query(
        'SELECT id, status FROM rounds WHERE id = ?',
        [roundId]
      );
      if (roundResult.rows.length === 0) {
        return res.status(400).json({ error: 'Round not found' });
      }
      if (roundResult.rows[0].status === 'completed') {
        return res.status(400).json({ error: 'Cannot create matches in a completed round' });
      }
    }

    // Enforce: home and away must be different when both are set
    const homeId = participant_home_id ?? null;
    const awayId = participant_away_id ?? null;
    if (homeId != null && awayId != null && homeId === awayId) {
      return res.status(400).json({ error: 'Home and away participants must be different' });
    }

    const id = crypto.randomUUID();
    const pub = published ? 1 : 0;
    const scheduledValue = normalizeDateTimeForMySQL(scheduled_at);

    await query(
      `INSERT INTO matches (
        id, round_id, participant_home_id, participant_away_id,
        scheduled_at, status,
        match_title, venue, published,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, NOW(), NOW())`,
      [
        id,
        roundId,
        participant_home_id || null,
        participant_away_id || null,
        scheduledValue,
        match_title || null,
        venue || null,
        pub,
      ]
    );

    const result = await query(
      `SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status,
       m.home_goals, m.away_goals, m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession,
       m.match_title, m.venue, m.published,
       m.started_at, m.ended_at, m.admin_id, m.created_at, m.updated_at
       FROM matches m WHERE m.id = ?`,
      [id]
    );
    const enriched = await enrichMatches(result.rows);
    res.status(201).json(enriched[0]);
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/matches/:id - delete a match (admin / super_admin)
 */
router.delete('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const exists = await query('SELECT id, status FROM matches WHERE id = ?', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    if (exists.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Cannot delete a completed match' });
    }

    await query('DELETE FROM matches WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/matches/:id - update match (metadata) - admin
 */
router.patch('/:id', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      scheduled_at,
      match_title,
      venue,
      participant_home_id,
      participant_away_id,
      published,
    } = req.body || {};
    const updates = [];
    const values = [];
    if (scheduled_at !== undefined) {
      updates.push('scheduled_at = ?');
      values.push(normalizeDateTimeForMySQL(scheduled_at));
    }
    if (match_title !== undefined) {
      updates.push('match_title = ?');
      values.push(match_title || null);
    }
    if (venue !== undefined) {
      updates.push('venue = ?');
      values.push(venue || null);
    }
    if (participant_home_id !== undefined) {
      updates.push('participant_home_id = ?');
      values.push(participant_home_id || null);
    }
    if (participant_away_id !== undefined) {
      updates.push('participant_away_id = ?');
      values.push(participant_away_id || null);
    }
    if (published !== undefined) {
      updates.push('published = ?');
      values.push(published ? 1 : 0);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    // Enforce: home and away cannot be the same participant (merge with current if only one updated)
    const currentMatch = await query(
      'SELECT participant_home_id, participant_away_id FROM matches WHERE id = ?',
      [id]
    );
    if (currentMatch.rows.length > 0) {
      const cur = currentMatch.rows[0];
      const finalHome = participant_home_id !== undefined ? (participant_home_id || null) : cur.participant_home_id;
      const finalAway = participant_away_id !== undefined ? (participant_away_id || null) : cur.participant_away_id;
      if (finalHome != null && finalAway != null && finalHome === finalAway) {
        return res.status(400).json({ error: 'Home and away participants must be different' });
      }
    }

    values.push(id);
    await query(
      `UPDATE matches SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    const result = await query(
      `SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status,
       m.home_goals, m.away_goals, m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession,
       m.match_title, m.venue, m.published,
       m.started_at, m.ended_at, m.admin_id, m.created_at, m.updated_at
       FROM matches m WHERE m.id = ?`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    const enriched = await enrichMatches(result.rows);
    res.json(enriched[0]);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/matches/:id/start - set status to ongoing, started_at - admin (idempotent)
 */
router.post('/:id/start', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const matchResult = await query('SELECT id, status, round_id FROM matches WHERE id = ?', [id]);
    if (matchResult.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    const match = matchResult.rows[0];
    if (match.status === 'ongoing') {
      const full = await query(
        'SELECT m.* FROM matches m WHERE m.id = ?',
        [id]
      );
      const enriched = await enrichMatches(full.rows);
      return res.json(enriched[0]);
    }
    if (match.status === 'completed') return res.status(400).json({ error: 'Match already completed' });
    await query(
      "UPDATE matches SET status = 'ongoing', started_at = NOW(), admin_id = ?, updated_at = NOW() WHERE id = ?",
      [req.user.id, id]
    );
    const full = await query(
      'SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status, m.home_goals, m.away_goals, m.started_at, m.ended_at FROM matches m WHERE m.id = ?',
      [id]
    );
    const enriched = await enrichMatches(full.rows);
    const updated = enriched[0];
    const io = req.app.get('io');
    if (io) io.emit('match:started', { matchId: id, match: updated });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/matches/:id/events - add goal event (body: event_type: goal_home | goal_away, minute)
 */
router.post('/:id/events', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { event_type, minute } = req.body;
    if (!['goal_home', 'goal_away'].includes(event_type)) {
      return res.status(400).json({ error: 'event_type must be goal_home or goal_away' });
    }
    const matchResult = await query('SELECT id, status, home_goals, away_goals FROM matches WHERE id = ?', [id]);
    if (matchResult.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    const match = matchResult.rows[0];
    if (match.status !== 'ongoing') return res.status(400).json({ error: 'Match is not ongoing' });
    const homeDelta = event_type === 'goal_home' ? 1 : 0;
    const awayDelta = event_type === 'goal_away' ? 1 : 0;
    const newHome = (match.home_goals ?? 0) + homeDelta;
    const newAway = (match.away_goals ?? 0) + awayDelta;
    await query(
      'UPDATE matches SET home_goals = ?, away_goals = ?, updated_at = NOW() WHERE id = ?',
      [newHome, newAway, id]
    );
    const eventId = crypto.randomUUID();
    await query(
      'INSERT INTO match_events (id, match_id, event_type, minute, created_at) VALUES (?, ?, ?, ?, NOW())',
      [eventId, id, event_type, minute ?? null]
    );
    const full = await query(
      'SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status, m.home_goals, m.away_goals, m.started_at, m.ended_at FROM matches m WHERE m.id = ?',
      [id]
    );
    const enriched = await enrichMatches(full.rows);
    const updated = enriched[0];
    const io = req.app.get('io');
    if (io) io.emit('match:goal', { matchId: id, home_goals: newHome, away_goals: newAway, event: { id: eventId, event_type, minute } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/matches/:id/end - set completed, ended_at, final stats; update participant avg stats; optionally advance round
 */
router.post('/:id/end', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { home_goals, away_goals, home_pass_accuracy, away_pass_accuracy, home_possession, away_possession } = req.body;
    const matchResult = await query(
      'SELECT id, round_id, status, participant_home_id, participant_away_id FROM matches WHERE id = ?',
      [id]
    );
    if (matchResult.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    const match = matchResult.rows[0];
    if (match.status === 'completed') {
      const full = await query(
        'SELECT m.* FROM matches m WHERE m.id = ?',
        [id]
      );
      const enriched = await enrichMatches(full.rows);
      return res.json(enriched[0]);
    }
    const hGoals = Number(home_goals) ?? 0;
    const aGoals = Number(away_goals) ?? 0;
    const hAcc = home_pass_accuracy != null ? Number(home_pass_accuracy) : null;
    const aAcc = away_pass_accuracy != null ? Number(away_pass_accuracy) : null;
    const hPoss = home_possession != null ? Number(home_possession) : null;
    const aPoss = away_possession != null ? Number(away_possession) : null;

    await query(
      `UPDATE matches SET status = 'completed', ended_at = NOW(), home_goals = ?, away_goals = ?,
       home_pass_accuracy = ?, away_pass_accuracy = ?, home_possession = ?, away_possession = ?,
       updated_at = NOW() WHERE id = ?`,
      [hGoals, aGoals, hAcc, aAcc, hPoss, aPoss, id]
    );

    const partIds = [match.participant_home_id, match.participant_away_id].filter(Boolean);
    for (const pid of partIds) {
      const partRow = await query(
        'SELECT avg_pass_accuracy, avg_possession FROM participants WHERE id = ?',
        [pid]
      );
      const p = partRow.rows[0];
      const isHome = match.participant_home_id === pid;
      const acc = isHome ? hAcc : aAcc;
      const poss = isHome ? hPoss : aPoss;
      if (acc != null || poss != null) {
        const newAcc = acc != null ? acc : (p?.avg_pass_accuracy ?? null);
        const newPoss = poss != null ? poss : (p?.avg_possession ?? null);
        await query(
          'UPDATE participants SET avg_pass_accuracy = COALESCE(?, avg_pass_accuracy), avg_possession = COALESCE(?, avg_possession) WHERE id = ?',
          [newAcc, newPoss, pid]
        );
      }
      const isLoser = (isHome && hGoals < aGoals) || (!isHome && aGoals < hGoals);
      if (isLoser) {
        await query('UPDATE participants SET eliminated = 1 WHERE id = ?', [pid]);
      }
    }

    const full = await query(
      'SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status, m.home_goals, m.away_goals, m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession, m.started_at, m.ended_at FROM matches m WHERE m.id = ?',
      [id]
    );
    const enriched = await enrichMatches(full.rows);
    const updated = enriched[0];

    const io = req.app.get('io');
    if (io) io.emit('match:ended', { matchId: id, match: updated });

    try {
      // Do not auto-create next round; admin will control release/creation.
      await tryAdvanceRound(match.round_id, false);
    } catch (_) {}

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/matches/:id/publish - mark match as published (admin / super_admin)
 * Optional body: { match_title, venue, scheduled_at }
 */
router.post('/:id/publish', requireAuth, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { match_title, venue, scheduled_at } = req.body || {};

    const updates = ['published = 1'];
    const values = [];

    if (match_title !== undefined) {
      updates.push('match_title = ?');
      values.push(match_title || null);
    }
    if (venue !== undefined) {
      updates.push('venue = ?');
      values.push(venue || null);
    }
    if (scheduled_at !== undefined) {
      updates.push('scheduled_at = ?');
      values.push(scheduled_at);
    }

    values.push(id);

    await query(
      `UPDATE matches
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      values
    );

    const result = await query(
      `SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at, m.status,
       m.home_goals, m.away_goals, m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession,
       m.match_title, m.venue, m.published,
       m.started_at, m.ended_at, m.admin_id, m.created_at, m.updated_at
       FROM matches m WHERE m.id = ?`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Match not found' });
    const enriched = await enrichMatches(result.rows);
    res.json(enriched[0]);
  } catch (e) {
    next(e);
  }
});

export default router;
