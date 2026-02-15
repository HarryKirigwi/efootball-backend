import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import paymentsRoutes from './routes/payments.js';
import tournamentRoutes from './routes/tournament.js';

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  'https://mksuefootball.vercel.app',
  'https://muefootball.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];
if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(...process.env.CORS_ORIGIN.split(',').map((o) => o.trim()));
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some((o) => origin === o)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
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
