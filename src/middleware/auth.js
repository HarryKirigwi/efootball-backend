import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const result = await query(
    'SELECT id, full_name, efootball_username, role, avatar_url FROM users WHERE id = ?',
    [decoded.userId]
  );
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.user = result.rows[0];
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
