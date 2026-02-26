import { query } from '../config/db.js';

const DEFAULT_START_TIME = '17:00'; // 5:00 PM
const DEFAULT_END_TIME = '19:00';   // 7:00 PM
const DEFAULT_GAMES_PER_DAY_ROUND1 = 10;
const SLOT_MINUTES = 12; // e.g. 5:00, 5:12, 5:24 within the window

/**
 * Get tournament config for scheduling (daily window, games per day).
 */
export async function getScheduleConfig() {
  const result = await query(
    'SELECT `key`, value_json FROM tournament_config WHERE `key` IN (?, ?, ?)',
    ['daily_start_time', 'daily_end_time', 'games_per_day_round1']
  );
  const config = {};
  for (const r of result.rows) {
    let val = r.value_json;
    if (typeof val === 'string' && (val.startsWith('"') || val === 'null')) {
      try {
        val = JSON.parse(val);
      } catch {}
    }
    config[r.key] = val;
  }
  return {
    dailyStartTime: config.daily_start_time || DEFAULT_START_TIME,
    dailyEndTime: config.daily_end_time || DEFAULT_END_TIME,
    gamesPerDayRound1: typeof config.games_per_day_round1 === 'number'
      ? config.games_per_day_round1
      : DEFAULT_GAMES_PER_DAY_ROUND1,
  };
}

/**
 * Parse "HH:mm" to minutes since midnight.
 */
function timeToMinutes(str) {
  const [h, m] = (str || '17:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Add days to a Date (date-only, no time).
 */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Generate scheduled_at for a list of matches for round 1 (10 per day).
 */
export async function assignScheduledAt(matches, roundNumber, tournamentStartDate) {
  if (matches.length === 0) return;
  const config = await getScheduleConfig();
  const startMins = timeToMinutes(config.dailyStartTime);
  const gamesPerDay = roundNumber === 1 ? config.gamesPerDayRound1 : Math.min(matches.length, 10);
  const slotMinutes = 12;

  const startDate = new Date(tournamentStartDate);
  startDate.setHours(0, 0, 0, 0);

  let currentDay = new Date(startDate);
  let slotInDay = 0;

  for (let i = 0; i < matches.length; i++) {
    if (slotInDay >= gamesPerDay) {
      currentDay = addDays(currentDay, 1);
      slotInDay = 0;
    }
    const minutesIntoDay = startMins + slotInDay * slotMinutes;
    const scheduled = new Date(currentDay);
    scheduled.setHours(Math.floor(minutesIntoDay / 60), minutesIntoDay % 60, 0, 0);
    matches[i].scheduled_at = scheduled;
    slotInDay++;
  }
}

/**
 * Get next available scheduled_at after a given date (for advance-round matches).
 */
export async function getNextSlot(afterDate, roundNumber) {
  const config = await getScheduleConfig();
  const startMins = timeToMinutes(config.dailyStartTime);
  const slotMinutes = 12;
  const day = new Date(afterDate);
  day.setHours(0, 0, 0, 0);
  const existing = await query(
    'SELECT scheduled_at FROM matches WHERE scheduled_at >= ? ORDER BY scheduled_at ASC LIMIT 100',
    [afterDate]
  );
  if (existing.rows.length === 0) {
    day.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
    return day;
  }
  const last = existing.rows[existing.rows.length - 1];
  const lastDt = last.scheduled_at ? new Date(last.scheduled_at) : new Date(day);
  return new Date(lastDt.getTime() + slotMinutes * 60 * 1000);
}
