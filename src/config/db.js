import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

function getPool() {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('mysql')) {
    return mysql.createPool(url);
  }
  const [user, password, host, port, database] = [
    process.env.DB_USER || 'root',
    process.env.DB_PASSWORD || '',
    process.env.DB_HOST || 'localhost',
    process.env.DB_PORT || 3306,
    process.env.DB_NAME || 'efootball',
  ];
  return mysql.createPool({ user, password, host, port, database });
}

const pool = getPool();

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
    // ignore logging errors
  }
};
// #endregion

const QUERY_TIMEOUT_MS = 15000;

export async function query(text, params = []) {
  DEBUG_LOG(
    'config/db.js:query',
    'db query start',
    { sqlPreview: String(text).slice(0, 80), paramsCount: params.length },
    'H2',
  );
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Query timeout')), QUERY_TIMEOUT_MS);
  });
  try {
    const [rows] = await Promise.race([pool.execute(text, params), timeoutPromise]);
    DEBUG_LOG(
      'config/db.js:query',
      'db query success',
      { sqlPreview: String(text).slice(0, 80) },
      'H2',
    );
    return { rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    DEBUG_LOG(
      'config/db.js:query',
      'db query error',
      { sqlPreview: String(text).slice(0, 80), error: e.message || String(e) },
      'H2',
    );
    throw e;
  }
}

export default pool;
