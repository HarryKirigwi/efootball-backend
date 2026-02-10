import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const { full_name, efootball_username, password, mpesa_transaction_code } = req.body;
    if (!full_name?.trim() || !efootball_username?.trim() || !password || !mpesa_transaction_code?.trim()) {
      return res.status(400).json({ error: 'full_name, efootball_username, password and mpesa_transaction_code are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = await query('SELECT id FROM users WHERE efootball_username = ?', [efootball_username.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'eFootball username already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, full_name, efootball_username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'participant', NOW(), NOW())`,
      [userId, full_name.trim(), efootball_username.trim(), passwordHash]
    );
    const user = { id: userId, full_name: full_name.trim(), efootball_username: efootball_username.trim(), role: 'participant', avatar_url: null };
    await query(
      `INSERT INTO payments (user_id, amount, mpesa_transaction_code, status, created_at)
       VALUES (?, 90, ?, 'pending', NOW())`,
      [userId, mpesa_transaction_code.trim()]
    );
    const token = signToken({ userId: user.id, role: user.role });
    res.status(201).json({
      user: { id: user.id, full_name: user.full_name, efootball_username: user.efootball_username, role: user.role, avatar_url: user.avatar_url },
      token,
      verified: false,
      message: 'Registration successful. Your payment is pending verification. You are not yet on the participants list.',
    });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { efootball_username, password } = req.body;
    if (!efootball_username?.trim() || !password) {
      return res.status(400).json({ error: 'efootball_username and password are required' });
    }
    const result = await query(
      'SELECT id, full_name, efootball_username, password_hash, role, avatar_url FROM users WHERE efootball_username = ?',
      [efootball_username.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const participantResult = await query('SELECT id FROM participants WHERE user_id = ?', [user.id]);
    const verified = participantResult.rows.length > 0;
    const token = signToken({ userId: user.id, role: user.role });
    res.json({
      user: {
        id: user.id,
        full_name: user.full_name,
        efootball_username: user.efootball_username,
        role: user.role,
        avatar_url: user.avatar_url,
      },
      token,
      verified,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
