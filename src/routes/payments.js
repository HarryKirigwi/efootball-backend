import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/pending', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT p.id, p.user_id, p.amount, p.mpesa_transaction_code, p.status, p.created_at,
              u.full_name, u.efootball_username
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = 'pending'
       ORDER BY p.created_at ASC`
    );
    res.json({ payments: result.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/verify', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }
    const payResult = await query(
      'SELECT id, user_id, status FROM payments WHERE id = ?',
      [id]
    );
    if (payResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const payment = payResult.rows[0];
    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Payment already processed' });
    }
    const newStatus = action === 'approve' ? 'verified' : 'rejected';
    await query(
      'UPDATE payments SET status = ?, verified_by_super_admin_id = ?, verified_at = NOW() WHERE id = ?',
      [newStatus, req.user.id, id]
    );
    if (action === 'approve') {
      const userResult = await query('SELECT full_name, efootball_username FROM users WHERE id = ?', [payment.user_id]);
      const user = userResult.rows[0];
      await query(
        `INSERT IGNORE INTO participants (user_id, full_name, efootball_username, eliminated, created_at)
         VALUES (?, ?, ?, 0, NOW())`,
        [payment.user_id, user.full_name, user.efootball_username]
      );
    }
    const countResult = await query('SELECT COUNT(*) AS count FROM participants');
    const participantCount = parseInt(countResult.rows[0].count, 10);
    res.json({
      success: true,
      payment_id: id,
      status: newStatus,
      participant_created: action === 'approve',
      total_participants: participantCount,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
