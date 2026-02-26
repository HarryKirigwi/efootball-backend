import crypto from 'crypto';
import { query } from '../config/db.js';
import { assignScheduledAt, getNextSlot } from './scheduleService.js';

/**
 * Get verified participants (in participants table, not eliminated), sorted by avg_pass_accuracy DESC, avg_possession DESC.
 */
export async function getRankedParticipants(limit = 128) {
  // LIMIT as a literal to avoid MySQL placeholder issues; limit is a trusted internal number
  const cappedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 128;
  const result = await query(
    `SELECT id, user_id, full_name, efootball_username,
            COALESCE(avg_pass_accuracy, 0) AS avg_pass_accuracy,
            COALESCE(avg_possession, 0)      AS avg_possession
     FROM participants
     WHERE eliminated = 0
     ORDER BY avg_pass_accuracy DESC, avg_possession DESC
     LIMIT ${cappedLimit}`
  );
  return result.rows;
}

/**
 * Create round record and return its id.
 */
export async function createRound(roundNumber, name, totalMatches, startDate, endDate) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO rounds (id, round_number, name, total_matches, start_date, end_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [id, roundNumber, name, totalMatches, startDate || null, endDate || null]
  );
  return id;
}

/**
 * Seed round 1 using the top-ranked participants. Pair 1v2, 3v4, ... by rank.
 * Creates round 1 and matches with scheduled_at from scheduleService.
 */
export async function seedRound1(tournamentStartDate) {
  const participants = await getRankedParticipants();
  if (participants.length < 2) {
    throw new Error('Need at least 2 participants to seed round 1');
  }

  const matchCount = Math.floor(participants.length / 2);
  const roundId = await createRound(1, 'Round 1', matchCount, tournamentStartDate, null);
  const matches = [];
  for (let i = 0; i < participants.length - 1; i += 2) {
    const home = participants[i];
    const away = participants[i + 1];
    matches.push({
      id: crypto.randomUUID(),
      round_id: roundId,
      participant_home_id: home.id,
      participant_away_id: away.id,
    });
  }

  await assignScheduledAt(matches, 1, tournamentStartDate);

  for (const m of matches) {
    await query(
      `INSERT INTO matches (id, round_id, participant_home_id, participant_away_id, scheduled_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', NOW(), NOW())`,
      [m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at]
    );
  }

  return { roundId, matchCount: matches.length };
}

/**
 * Get all matches in a round.
 */
export async function getMatchesByRound(roundId) {
  const result = await query(
    `SELECT m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.status, m.home_goals, m.away_goals,
            m.home_pass_accuracy, m.away_pass_accuracy, m.home_possession, m.away_possession, m.started_at, m.ended_at, m.scheduled_at
     FROM matches m
     WHERE m.round_id = ?
     ORDER BY m.scheduled_at ASC, m.created_at ASC`,
    [roundId]
  );
  return result.rows;
}

/**
 * Determine winner of a completed match (participant_id). Tie = null (both advance or use stats).
 */
function getWinner(match) {
  if (match.status !== 'completed') return null;
  const h = match.home_goals ?? 0;
  const a = match.away_goals ?? 0;
  if (h > a) return match.participant_home_id;
  if (a > h) return match.participant_away_id;
  return null;
}

/**
 * Get participant stats from a completed match for seeding (pass_accuracy, possession).
 */
function getParticipantStatsFromMatch(match, participantId) {
  const isHome = match.participant_home_id === participantId;
  return {
    pass_accuracy: isHome ? (match.home_pass_accuracy ?? 0) : (match.away_pass_accuracy ?? 0),
    possession: isHome ? (match.home_possession ?? 0) : (match.away_possession ?? 0),
  };
}

/**
 * After a round is complete: get winners, sort by (pass_accuracy, possession) DESC, pair 1v2, 3v4...
 * Create next round and matches; assign scheduled_at.
 */
export async function advanceRound(roundId) {
  const matches = await getMatchesByRound(roundId);
  if (matches.length === 0) throw new Error('Round has no matches');

  const allCompleted = matches.every((m) => m.status === 'completed');
  if (!allCompleted) throw new Error('Not all matches in this round are completed');

  const roundResult = await query('SELECT round_number, name FROM rounds WHERE id = ?', [roundId]);
  const currentRoundNumber = roundResult.rows[0]?.round_number ?? 1;
  const nextRoundNumber = currentRoundNumber + 1;

  const winnerIds = new Set();
  const winnerStats = {}; // participant_id -> { pass_accuracy, possession } from their last match
  for (const m of matches) {
    const wid = getWinner(m);
    if (wid) {
      winnerIds.add(wid);
      const st = getParticipantStatsFromMatch(m, wid);
      if (!winnerStats[wid] || st.pass_accuracy > (winnerStats[wid].pass_accuracy || 0)) {
        winnerStats[wid] = st;
      }
    }
  }

  const participants = await query(
    `SELECT id, full_name, efootball_username FROM participants WHERE id IN (${Array.from(winnerIds).map(() => '?').join(',')})`,
    [...winnerIds]
  );
  const byId = Object.fromEntries(participants.rows.map((p) => [p.id, p]));

  const ranked = [...winnerIds].sort((a, b) => {
    const sa = winnerStats[a] || { pass_accuracy: 0, possession: 0 };
    const sb = winnerStats[b] || { pass_accuracy: 0, possession: 0 };
    if (sb.pass_accuracy !== sa.pass_accuracy) return sb.pass_accuracy - sa.pass_accuracy;
    return (sb.possession || 0) - (sa.possession || 0);
  });

  const nextMatchCount = Math.floor(ranked.length / 2);
  const roundNames = {
    2: 'Round of 64',
    3: 'Round of 32',
    4: 'Round of 16',
    5: 'Quarter-finals',
    6: 'Semi-finals',
    7: 'Final',
  };
  const name = roundNames[nextRoundNumber] || `Round ${nextRoundNumber}`;

  const lastScheduled = await query(
    'SELECT scheduled_at FROM matches ORDER BY scheduled_at DESC LIMIT 1'
  );
  const afterDate = lastScheduled.rows[0]?.scheduled_at
    ? new Date(lastScheduled.rows[0].scheduled_at)
    : new Date();

  const newRoundId = await createRound(nextRoundNumber, name, nextMatchCount, null, null);

  const newMatches = [];
  for (let i = 0; i < ranked.length - 1; i += 2) {
    newMatches.push({
      id: crypto.randomUUID(),
      round_id: newRoundId,
      participant_home_id: ranked[i],
      participant_away_id: ranked[i + 1],
    });
  }

  let slot = await getNextSlot(afterDate, nextRoundNumber);
  for (const m of newMatches) {
    m.scheduled_at = new Date(slot);
    slot = new Date(slot.getTime() + 12 * 60 * 1000);
  }

  for (const m of newMatches) {
    await query(
      `INSERT INTO matches (id, round_id, participant_home_id, participant_away_id, scheduled_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', NOW(), NOW())`,
      [m.id, m.round_id, m.participant_home_id, m.participant_away_id, m.scheduled_at]
    );
  }

  return { roundId: newRoundId, matchCount: newMatches.length };
}

/**
 * Check if all matches in a round are completed and optionally run advanceRound.
 */
export async function tryAdvanceRound(roundId, autoAdvance = true) {
  const matches = await getMatchesByRound(roundId);
  if (matches.length === 0) return null;
  const allCompleted = matches.every((m) => m.status === 'completed');
  if (!allCompleted) return null;
  if (autoAdvance) return advanceRound(roundId);
  return { roundId };
}
