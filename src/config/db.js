import mysql from 'mysql2/promise';

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

export async function query(text, params = []) {
  const [rows] = await pool.execute(text, params);
  return { rows: Array.isArray(rows) ? rows : [] };
}

export default pool;
