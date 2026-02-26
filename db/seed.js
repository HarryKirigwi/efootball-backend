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

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      // Ignore "duplicate column" / "duplicate key" errors so migrations are idempotent across environments.
      if (err && (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME')) {
        continue;
      }
      throw err;
    }
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
    // Run only these additive migrations (003 fixtures, 003 matches, 005, 006). No 001/002; no super admin seed.
    const migration003Fixtures = await loadSql(path.join('migrations', '003_fixtures_rounds.sql'));
    await runStatements(pool, migration003Fixtures, runId, 'H3', 'migration_003_fixtures_rounds');

    const migration003Matches = await loadSql(path.join('migrations', '003_matches_rounds_overhaul.sql'));
    await runStatements(pool, migration003Matches, runId, 'H3M', 'migration_003_matches_rounds_overhaul');

    const migration005 = await loadSql(path.join('migrations', '005_add_updated_at_to_rounds.sql'));
    await runStatements(pool, migration005, runId, 'H5', 'migration_005_add_updated_at_to_rounds');

    const migration006 = await loadSql(path.join('migrations', '006_add_suggestion_seed.sql'));
    await runStatements(pool, migration006, runId, 'H6', 'migration_006_add_suggestion_seed');

    console.log('Migrations (003 fixtures, 003 matches, 005, 006) ran successfully.');
  } finally {
    await pool.end();
  }
}

seed('post-fix').catch((e) => {
  console.error(e);
  process.exit(1);
});
