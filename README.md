## eFootball Backend API

This is the Express API for the Machakos University eFootball tournament. It is designed to run locally and on Railway with a managed MySQL database.

### Required environment variables (Railway)

Set these on your Railway backend service:

- `PORT` – Railway will inject this automatically; the app also defaults to `4000`.
- `DATABASE_URL` – MySQL connection URL from the Railway MySQL service (e.g. `mysql://user:password@host:3306/efootball`).
- `JWT_SECRET` – A strong random string used to sign JWTs.
- `NODE_ENV` – Set to `production` on Railway.
- `SEED_SUPER_ADMIN_PASSWORD` (optional) – Password to use when seeding the super admin; defaults to `SuperAdmin123!` if not set.
- `CORS_ORIGIN` (optional) – Frontend origin allowed to call the API in production (e.g. `https://your-frontend-domain`).

### Local development

1. Copy `.env.example` to `.env` and adjust values for your local MySQL instance.
2. Install dependencies and start the server:

```bash
npm install
npm run dev
```

The API will be available at `http://localhost:4000/api`.

### Database migrations and seeding

The `db/seed.js` script will:

- Run `db/001_initial.sql` to create the database schema.
- Run `db/seed_super_admin.sql` to insert the initial super admin user.

To run it locally:

```bash
npm run seed
```

On Railway, run the same command once from the service \"Run\"/\"Shell\" tab after configuring `DATABASE_URL`.

