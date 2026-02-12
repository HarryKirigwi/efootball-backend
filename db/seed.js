import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

async function loadSql(file) {
  const fullPath = path.join(__dirname, file);
  return fs.readFile(fullPath, 'utf8');
}

async function seed() {
  const url = process.env.DATABASE_URL;
  const pool = url && url.startsWith('mysql')
    ? mysql.createPool(url)
    : mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        port: process.env.DB_PORT || 3306,
        database: process.env.DB_NAME || 'efootball',
      });

  try {
    const schemaSql = await loadSql('001_initial.sql');
    await pool.query(schemaSql);

    const superAdminSql = await loadSql('seed_super_admin.sql');
    await pool.query(superAdminSql);

    console.log('Database schema and super admin seeded successfully.');
  } finally {
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
