# Bitech DC4AI

**Data Collection for Artificial Intelligence** — a role-based data access platform that lets organizations manage users and roles with granular permissions to query AWS-backed data sources through a visual query builder or custom SQL interface.

---

## Features

- **Role-Based Access Control (RBAC)** — table-level, column-level, and row-level permissions per role
- **Visual Query Builder** — select data sources, pick columns, apply filters with live schema discovery
- **Custom SQL Editor** — write raw SQL with multi-table LEFT JOIN support
- **Programmatic REST API** — API key authentication with inherited role permissions, JSON or CSV output
- **AWS-Native** — Cognito for auth, Athena for query execution, Glue for schema discovery, Lake Formation for fine-grained data control
- **German Language Support** — character normalization (ä→a, ö→o, ü→u, ß→ss) applied to filters
- **Query History** — audit log of executed queries with execution time and row counts

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query |
| Backend | Node.js 20, Express.js, TypeScript |
| Database | PostgreSQL 14+, Drizzle ORM |
| Auth | AWS Cognito (JWT / `ADMIN_USER_PASSWORD_AUTH` flow) |
| Query Engine | AWS Athena |
| Data Catalog | AWS Glue |
| Access Control | AWS Lake Formation + IAM |
| Deployment | Docker, EC2, PM2, AWS CloudFormation |

---

## Project Structure

```
bitech-prod/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── components/      # UI components (sidebar, filters, query builder)
│       ├── pages/           # Pages: login, setup, data-viewer, roles, users, api-keys, api-docs
│       ├── lib/             # Auth context, query client, utilities
│       └── hooks/           # Custom React hooks
├── server/                  # Express backend
│   ├── routes.ts            # All API endpoints
│   ├── storage.ts           # Database operations (Drizzle)
│   ├── middleware/auth.ts   # JWT validation, permission checks
│   └── aws/                 # Cognito, Athena, Glue, IAM, Lake Formation clients
├── shared/
│   ├── schema.ts            # Drizzle table definitions + Zod schemas
│   └── sql-normalize.ts     # German character normalization
├── migrations/              # Drizzle database migrations
├── Dockerfile               # Multi-stage Docker build
└── drizzle.config.ts        # Drizzle ORM config
```

---

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- AWS account with:
  - Cognito User Pool (with `ADMIN_USER_PASSWORD_AUTH` flow enabled)
  - Athena + S3 output bucket
  - Glue Data Catalog
  - Lake Formation permissions configured

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/dc4ai

# AWS
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ACCOUNT_ID=

# Cognito
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=

# Athena
ATHENA_OUTPUT_LOCATION=s3://your-bucket/athena-results/

# App
NODE_ENV=development
PORT=5000
```

---

## Local Setup

```bash
# Install dependencies
npm install

# Set up the database
npm run db:push

# Start development server
npm run dev
```

The app runs at `http://localhost:5000`.

On first launch with an empty database, you'll be directed to the setup page to create the initial admin account.

For detailed setup instructions including AWS configuration, see [LOCAL_SETUP.md](./LOCAL_SETUP.md).

---

## Build & Run (Production)

```bash
# Build frontend + backend
npm run build

# Start production server
npm start
```

Or with Docker:

```bash
docker build -t dc4ai .
docker run -p 5000:5000 --env-file .env dc4ai
```

---

## API Overview

### Authentication

All API requests (except setup and public API) require a Bearer token obtained from `/api/auth/login`.

```
Authorization: Bearer <token>
```

### Key Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login with email + password |
| `GET` | `/api/auth/me` | Get current user |
| `GET` | `/api/setup/status` | Check if initial setup is needed |
| `POST` | `/api/setup/admin` | Create first admin user (once only) |
| `GET` | `/api/data-sources/schemas` | Get all data source schemas |
| `GET` | `/api/data-sources/:id/columns` | Get columns for a data source |
| `POST` | `/api/query/execute` | Execute a query |
| `GET` | `/api/roles` | List roles (admin only) |
| `POST` | `/api/roles` | Create role (admin only) |
| `GET` | `/api/users` | List users (admin only) |
| `POST` | `/api/users` | Create user (admin only) |
| `GET` | `/api/api-keys` | List API keys |
| `POST` | `/api/api-keys` | Create API key |
| `GET` | `/api/health` | Health check |

### Public REST API

Fetch data programmatically using an API key:

```
GET /api/v1/fetch
x-api-key: <your-api-key>
x-data-source: crime_data_silver
```

Supports JSON and CSV output (`Accept` header), column selection, row filters, and multi-source JOINs via `x-data-sources`.

---

## Data Sources

The platform provides access to five AWS Glue-managed datasets:

| Data Source | Table |
|---|---|
| Crime | `crime_data_silver` |
| Events | `events_data_silver` |
| Insurance | `policy_claims_data_silver` |
| Traffic | `traffic_data_silver` |
| Weather | `weather_data_silver` |

Staging uses `bitech_staging_db`; production uses `bitech_prod_db` in the Glue catalog.

---

## Database Schema

| Table | Purpose |
|---|---|
| `roles` | Role definitions with JSONB permissions |
| `users` | App users linked to Cognito identities |
| `queryHistory` | Audit log of query executions |
| `apiKeys` | SHA256-hashed API keys per user |

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run db:push` | Push schema changes to database |
| `npm run check` | TypeScript type check |
