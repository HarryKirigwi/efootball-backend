import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'profile-pre-fix',
        hypothesisId: 'H5',
        location: 'backend/src/routes/users.js:/me',
        message: 'Handling /users/me request',
        data: { userId: req.user.id, role: req.user.role },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    const participantResult = await query(
      'SELECT id, full_name, efootball_username, avg_pass_accuracy, avg_possession, eliminated FROM participants WHERE user_id = ?',
      [req.user.id]
    );
    const participant = participantResult.rows[0] || null;

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'profile-pre-fix',
        hypothesisId: 'H6',
        location: 'backend/src/routes/users.js:/me',
        message: 'Participant lookup result for /users/me',
        data: { userId: req.user.id, participantFound: !!participant },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    res.json({
      user: req.user,
      participant: participant ? { ...participant, verified: true } : null,
      verified: !!participant,
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { full_name, avatar_url } = req.body;
    const updates = [];
    const values = [];
    let i = 1;
    if (full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(full_name.trim());
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      values.push(avatar_url);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    values.push(req.user.id);
    await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    const userResult = await query('SELECT id, full_name, efootball_username, role, avatar_url FROM users WHERE id = ?', [req.user.id]);
    const user = userResult.rows[0];
    const participantResult = await query('SELECT id, full_name, efootball_username FROM participants WHERE user_id = ?', [user.id]);
    res.json({ user, participant: participantResult.rows[0] || null, verified: participantResult.rows.length > 0 });
  } catch (e) {
    next(e);
  }
});

router.post('/admins', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { full_name, efootball_username, password } = req.body;
    if (!full_name?.trim() || !efootball_username?.trim() || !password) {
      return res.status(400).json({ error: 'full_name, efootball_username and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = await query('SELECT id FROM users WHERE efootball_username = ?', [efootball_username.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'eFootball username already in use' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, full_name, efootball_username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', NOW(), NOW())`,
      [userId, full_name.trim(), efootball_username.trim(), passwordHash]
    );
    const user = { id: userId, full_name: full_name.trim(), efootball_username: efootball_username.trim(), role: 'admin', created_at: new Date() };
    await query(
      'INSERT INTO admins (user_id, created_by_super_admin_id, created_at) VALUES (?, ?, NOW())',
      [userId, req.user.id]
    );
    res.status(201).json({ user });
  } catch (e) {
    next(e);
  }
});

router.get('/list', requireAuth, requireRole('super_admin', 'admin'), async (req, res, next) => {
  try {
    const { role } = req.query;
    let q = 'SELECT id, full_name, efootball_username, role, avatar_url, created_at FROM users WHERE 1=1';
    const params = [];
    if (role) {
      params.push(role);
      q += ' AND role = ?';
    }
    q += ' ORDER BY created_at DESC';
    const result = await query(q, params);
    const withParticipants = await Promise.all(
      result.rows.map(async (u) => {
        const p = await query('SELECT id FROM participants WHERE user_id = ?', [u.id]);
        return { ...u, is_participant: p.rows.length > 0 };
      })
    );
    res.json({ users: withParticipants });
  } catch (e) {
    next(e);
  }
});

export default router;
