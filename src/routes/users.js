import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

function normalizePhone(val) {
  if (!val) return null;
  const digits = val.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1);
  if (digits.length === 9 && /^[17]/.test(digits)) return '254' + digits;
  return null;
}

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const participantResult = await query(
      'SELECT id, full_name, efootball_username, avg_pass_accuracy, avg_possession, eliminated FROM participants WHERE user_id = ?',
      [req.user.id]
    );
    const participant = participantResult.rows[0] || null;
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
    let q =
      'SELECT u.id, u.full_name, u.efootball_username, u.role, u.avatar_url, u.created_at, p.id AS participant_id ' +
      'FROM users u ' +
      'LEFT JOIN participants p ON p.user_id = u.id ' +
      'WHERE 1=1';
    const params = [];
    if (role) {
      params.push(role);
      q += ' AND u.role = ?';
    }
    q += ' ORDER BY u.created_at DESC';
    const result = await query(q, params);
    const withParticipants = result.rows.map((u) => ({
      ...u,
      is_participant: !!u.participant_id,
    }));
    res.json({ users: withParticipants });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT 
         u.id,
         u.full_name,
         u.reg_no,
         u.efootball_username,
         u.role,
         u.avatar_url,
         u.phone_number,
         u.created_at,
         u.updated_at,
         p.id AS participant_id,
         p.full_name AS participant_full_name,
         p.efootball_username AS participant_username,
         p.avg_pass_accuracy,
         p.avg_possession,
         p.eliminated
       FROM users u
       LEFT JOIN participants p ON p.user_id = u.id
       WHERE u.id = ?
      `,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const row = result.rows[0];
    const user = {
      id: row.id,
      full_name: row.full_name,
      reg_no: row.reg_no,
      efootball_username: row.efootball_username,
      role: row.role,
      avatar_url: row.avatar_url,
      phone_number: row.phone_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_participant: !!row.participant_id,
    };
    const participant = row.participant_id
      ? {
          id: row.participant_id,
          full_name: row.participant_full_name,
          efootball_username: row.participant_username,
          avg_pass_accuracy: row.avg_pass_accuracy,
          avg_possession: row.avg_possession,
          eliminated: row.eliminated,
        }
      : null;

    res.json({ user, participant });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      full_name,
      efootball_username,
      reg_no,
      phone_number,
      is_participant,
    } = req.body;

    const existingResult = await query(
      'SELECT id, full_name, reg_no, efootball_username, role, avatar_url, phone_number FROM users WHERE id = ?',
      [id]
    );
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const params = [];

    if (full_name !== undefined) {
      if (!full_name.trim()) {
        return res.status(400).json({ error: 'full_name cannot be empty' });
      }
      updates.push('full_name = ?');
      params.push(full_name.trim());
    }

    if (efootball_username !== undefined) {
      if (!efootball_username.trim()) {
        return res.status(400).json({ error: 'efootball_username cannot be empty' });
      }
      updates.push('efootball_username = ?');
      params.push(efootball_username.trim());
    }

    if (reg_no !== undefined) {
      if (!reg_no.trim()) {
        return res.status(400).json({ error: 'reg_no cannot be empty' });
      }
      updates.push('reg_no = ?');
      params.push(reg_no.trim());
    }

    if (phone_number !== undefined) {
      const normalized = normalizePhone(String(phone_number).trim());
      if (!normalized) {
        return res.status(400).json({ error: 'Enter a valid Kenyan phone number (e.g. 07XXXXXXXX or 2547XXXXXXXX)' });
      }
      updates.push('phone_number = ?');
      params.push(normalized);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        [...params, id]
      );
    }

    if (typeof is_participant === 'boolean') {
      if (is_participant) {
        const userResult = await query(
          'SELECT full_name, efootball_username FROM users WHERE id = ?',
          [id]
        );
        const user = userResult.rows[0];
        await query(
          `INSERT IGNORE INTO participants (user_id, full_name, efootball_username, eliminated, created_at)
           VALUES (?, ?, ?, 0, NOW())`,
          [id, user.full_name, user.efootball_username]
        );
      } else {
        await query('DELETE FROM participants WHERE user_id = ?', [id]);
      }
    }

    // Return the updated view of the user
    const result = await query(
      `SELECT 
         u.id,
         u.full_name,
         u.reg_no,
         u.efootball_username,
         u.role,
         u.avatar_url,
         u.phone_number,
         u.created_at,
         u.updated_at,
         p.id AS participant_id,
         p.full_name AS participant_full_name,
         p.efootball_username AS participant_username,
         p.avg_pass_accuracy,
         p.avg_possession,
         p.eliminated
       FROM users u
       LEFT JOIN participants p ON p.user_id = u.id
       WHERE u.id = ?
      `,
      [id]
    );

    const row = result.rows[0];
    const user = {
      id: row.id,
      full_name: row.full_name,
      reg_no: row.reg_no,
      efootball_username: row.efootball_username,
      role: row.role,
      avatar_url: row.avatar_url,
      phone_number: row.phone_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_participant: !!row.participant_id,
    };
    const participant = row.participant_id
      ? {
          id: row.participant_id,
          full_name: row.participant_full_name,
          efootball_username: row.participant_username,
          avg_pass_accuracy: row.avg_pass_accuracy,
          avg_possession: row.avg_possession,
          eliminated: row.eliminated,
        }
      : null;

    res.json({ user, participant });
  } catch (e) {
    next(e);
  }
});

export default router;
