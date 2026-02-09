# Bitech DC4AI - Local Setup Guide

This guide walks you through downloading and running the Bitech DC4AI platform on your local machine.

---

## Prerequisites

Make sure you have the following installed:

- **Node.js** v20 or later — [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **PostgreSQL** 14 or later — [Download here](https://www.postgresql.org/download/)
- **Git** — [Download here](https://git-scm.com/)

You will also need:

- An **AWS account** with access to the following services: Cognito, Athena, Glue, Lake Formation, IAM, S3
- A **Cognito User Pool** with an app client that has `ADMIN_USER_PASSWORD_AUTH` flow enabled

---

## Step 1: Download the Code

If you have the code as a zip file, extract it to a folder. Otherwise, clone the repository:

```bash
git clone <your-repo-url>
cd <project-folder>
```

---

## Step 2: Install Dependencies

```bash
npm install
```

---

## Step 3: Set Up PostgreSQL

1. Make sure PostgreSQL is running on your machine.
2. Create a new database:

```bash
psql -U postgres
CREATE DATABASE dc4ai;
\q
```

---

## Step 4: Configure Environment Variables

Create a `.env` file in the project root with the following values:

```env
# Database
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/dc4ai

# AWS Credentials
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key

# AWS Cognito
COGNITO_USER_POOL_ID=your_cognito_user_pool_id
COGNITO_CLIENT_ID=your_cognito_client_id

# Athena
ATHENA_OUTPUT_LOCATION=s3://your-bucket/athena-results/

# Session
SESSION_SECRET=any_random_string_here
```

Replace each placeholder with your actual values.

**Important:** The Cognito app client must have the `ADMIN_USER_PASSWORD_AUTH` authentication flow enabled.

---

## Step 5: Push the Database Schema

This creates all the required tables in your PostgreSQL database:

```bash
npm run db:push
```

---

## Step 6: Start the Application

```bash
npm run dev
```

The application will start and be available at **http://localhost:5000**.

---

## Step 7: Initial Setup

When you open the app for the first time (with an empty database), you'll see a **Setup** page:

1. Enter a **name**, **email**, and **password** for the first admin user.
2. This creates the user in both your AWS Cognito User Pool and the local database.
3. You'll be automatically logged in after setup.

---

## Building for Production

To create a production build:

```bash
npm run build
```

To run the production build:

```bash
npm start
```

---

## Project Structure

```
├── client/              # React frontend (Vite)
│   └── src/
│       ├── components/  # UI components
│       ├── pages/       # Application pages
│       ├── lib/         # Utilities and API client
│       └── hooks/       # Custom React hooks
├── server/              # Express backend
│   ├── aws/             # AWS service integrations (Cognito, Athena, Glue, etc.)
│   ├── middleware/      # Auth middleware
│   ├── routes.ts        # API endpoints
│   └── storage.ts       # Database operations
├── shared/              # Shared types and database schema
│   └── schema.ts        # Drizzle ORM table definitions
├── migrations/          # Database migrations
└── package.json
```

---

## Troubleshooting

**"Cannot connect to database"**
- Make sure PostgreSQL is running and the `DATABASE_URL` in your `.env` file is correct.

**"ADMIN_USER_PASSWORD_AUTH not enabled"**
- Go to your AWS Cognito Console → User Pool → App clients → Edit the app client → Enable `ADMIN_USER_PASSWORD_AUTH` under Authentication flows.

**"Lake Formation access denied" on certain data sources**
- The AWS IAM user whose credentials you're using needs Lake Formation permissions (SELECT with column access) on the Glue tables you want to query.

**Port 5000 already in use**
- Stop any other process using port 5000, or change the port in `server/index.ts`.
