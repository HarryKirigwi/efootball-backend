import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import paymentsRoutes from './routes/payments.js';
import tournamentRoutes from './routes/tournament.js';

const app = express();
const PORT = process.env.PORT || 4000;

// In development we load env vars from .env; in production (Railway) env vars are injected.
if (process.env.NODE_ENV !== 'production') {
  await import('dotenv/config');
}

// Allow configurable CORS origin for production; default is permissive for local dev.
const corsOrigin = process.env.CORS_ORIGIN || true;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/tournament', tournamentRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
