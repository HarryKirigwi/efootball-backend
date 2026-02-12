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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'profile-pre-fix',
        hypothesisId: 'H1',
        location: 'backend/src/middleware/auth.js:requireAuth',
        message: 'Missing auth token on protected route',
        data: { path: req.path, method: req.method },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return res.status(401).json({ error: 'Authentication required' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'profile-pre-fix',
        hypothesisId: 'H2',
        location: 'backend/src/middleware/auth.js:requireAuth',
        message: 'Invalid or expired token',
        data: { path: req.path, method: req.method },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const result = await query(
    'SELECT id, full_name, efootball_username, role, avatar_url FROM users WHERE id = ?',
    [decoded.userId]
  );
  if (result.rows.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'profile-pre-fix',
        hypothesisId: 'H3',
        location: 'backend/src/middleware/auth.js:requireAuth',
        message: 'User id from token not found',
        data: { path: req.path, method: req.method, userId: decoded.userId },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return res.status(401).json({ error: 'User not found' });
  }
  req.user = result.rows[0];

  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/1357bc2d-b052-460a-9bba-5b23097c9172', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: 'profile-pre-fix',
      hypothesisId: 'H4',
      location: 'backend/src/middleware/auth.js:requireAuth',
      message: 'Authenticated user for request',
      data: { path: req.path, method: req.method, userId: req.user.id, role: req.user.role },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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
