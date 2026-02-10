import 'dotenv/config';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';

const pool = mysql.createPool(process.env.DATABASE_URL || { host: 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'efootball' });

const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';

async function seed() {
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  await pool.execute(
    `INSERT INTO users (id, full_name, efootball_username, password_hash, role, created_at, updated_at)
     VALUES (UUID(), ?, ?, ?, 'super_admin', NOW(), NOW())
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'super_admin'`,
    ['Super Admin', 'superadmin', passwordHash]
  );
  console.log('Super admin seeded. Username: superadmin, Password:', SUPER_ADMIN_PASSWORD);
  await pool.end();
}

seed().catch((e) => { console.error(e); process.exit(1); });
