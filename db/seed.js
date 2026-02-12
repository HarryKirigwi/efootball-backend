import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSql(file) {
  const fullPath = path.join(__dirname, file);
  return fs.readFile(fullPath, 'utf8');
}

async function runStatements(pool, sql, runId, hypothesisId, label) {
  // Remove full-line comments first, then split into individual statements.
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId,
      hypothesisId,
      location: 'db/seed.js:runStatements',
      message: `Executing SQL statements for ${label}`,
      data: { count: statements.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

async function seed(runId = 'pre-fix') {
  const url = process.env.DATABASE_URL;
  const pool =
    url && url.startsWith('mysql')
      ? mysql.createPool(url)
      : mysql.createPool({
          host: process.env.DB_HOST || 'localhost',
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          port: process.env.DB_PORT || 3306,
          database: process.env.DB_NAME || 'efootball',
        });

  try {
    const schemaSql = await loadSql(path.join('migrations', '001_initial.sql'));
    await runStatements(pool, schemaSql, runId, 'H1', 'schema');

    const superAdminSql = await loadSql('seed_super_admin.sql');
    await runStatements(pool, superAdminSql, runId, 'H2', 'super_admin');

    console.log('Database schema and super admin seeded successfully.');
  } finally {
    await pool.end();
  }
}

seed('post-fix').catch((e) => {
  console.error(e);
  process.exit(1);
});
