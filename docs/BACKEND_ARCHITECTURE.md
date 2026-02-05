# Bitech DC4AI - Backend Architecture Overview

This document provides a comprehensive overview of the backend architecture, AWS integrations, and data flow for the DC4AI (Data Collection 4 Artificial Intelligence) platform.

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Database Schema](#database-schema)
4. [Authentication Flow](#authentication-flow)
5. [AWS Service Integration](#aws-service-integration)
6. [Role & Permission Management](#role--permission-management)
7. [Query Execution Flow](#query-execution-flow)
8. [Public REST API Flow](#public-rest-api-flow)
9. [API Route Summary](#api-route-summary)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (React)                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Login Page │  │ Data Viewer │  │ Role Mgmt   │  │ User Mgmt   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXPRESS.JS BACKEND                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Auth Middleware                                  │   │
│  │   - JWT Verification (Cognito or Demo Token)                         │   │
│  │   - User Lookup & Role Resolution                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Auth Routes │  │ Role Routes │  │ User Routes │  │Query Routes │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AWS SERVICES                                       │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │  Cognito  │  │    IAM    │  │   Lake    │  │   Glue    │  │  Athena   │ │
│  │           │  │           │  │ Formation │  │           │  │           │ │
│  │ Auth/User │  │IAM Roles  │  │Fine-grain │  │  Schema   │  │  Query    │ │
│  │ Mgmt      │  │& Policies │  │ Access    │  │ Discovery │  │ Execution │ │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘ │
│                                                              ┌───────────┐ │
│                                                              │    S3     │ │
│                                                              │  Results  │ │
│                                                              └───────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         POSTGRESQL DATABASE                                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐                │
│  │   roles   │  │   users   │  │ api_keys  │  │  query_   │                │
│  │           │  │           │  │           │  │  history  │                │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js with Express.js |
| Language | TypeScript (ES Modules) |
| Database | PostgreSQL with Drizzle ORM |
| Authentication | AWS Cognito (with Demo Mode fallback) |
| Data Catalog | AWS Glue |
| Query Engine | AWS Athena |
| Fine-grained Access | AWS Lake Formation |
| Role Management | AWS IAM |
| Result Storage | AWS S3 |

---

## Database Schema

### Tables Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           ROLES                                  │
├─────────────────────────────────────────────────────────────────┤
│ id             │ VARCHAR (UUID)    │ Primary Key                │
│ name           │ TEXT              │ Unique role name           │
│ description    │ TEXT              │ Optional description       │
│ is_admin       │ BOOLEAN           │ Admin access flag          │
│ can_generate_  │ BOOLEAN           │ API key generation access  │
│   api_keys     │                   │                            │
│ permissions    │ JSONB             │ DataSourcePermission[]     │
│ iam_role_arn   │ TEXT              │ Associated AWS IAM Role    │
│ created_at     │ TIMESTAMP         │                            │
│ updated_at     │ TIMESTAMP         │                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:N
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                           USERS                                  │
├─────────────────────────────────────────────────────────────────┤
│ id             │ VARCHAR (UUID)    │ Primary Key                │
│ cognito_user_id│ TEXT              │ Cognito sub (unique)       │
│ name           │ TEXT              │ User display name          │
│ email          │ TEXT              │ Unique email               │
│ role_id        │ VARCHAR           │ FK → roles.id              │
│ is_active      │ BOOLEAN           │ Account status             │
│ created_at     │ TIMESTAMP         │                            │
│ updated_at     │ TIMESTAMP         │                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:N
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          API_KEYS                                │
├─────────────────────────────────────────────────────────────────┤
│ id             │ VARCHAR (UUID)    │ Primary Key                │
│ user_id        │ VARCHAR           │ FK → users.id              │
│ name           │ TEXT              │ Key description            │
│ key_hash       │ TEXT              │ SHA256 hash of key         │
│ key_prefix     │ TEXT              │ First 12 chars for display │
│ is_revoked     │ BOOLEAN           │ Revocation status          │
│ created_at     │ TIMESTAMP         │                            │
└─────────────────────────────────────────────────────────────────┘
```

### Permission Structure (JSONB)

```typescript
interface DataSourcePermission {
  dataSourceId: "crime-data-db" | "events-data-db" | "insurance-data-db" | 
                "traffic-data-db" | "weather-data-db";
  hasAccess: boolean;
  tables: TablePermission[];
}

interface TablePermission {
  tableName: string;
  columns: string[];        // Specific columns if not allColumns
  allColumns: boolean;      // Access to all columns
  allRows: boolean;         // Access to all rows
  rowFilters?: RowFilterCondition[];  // Row-level filters
}

interface RowFilterCondition {
  column: string;
  operator: "equals" | "not_equals" | "contains" | 
            "greater_than" | "less_than" | "in";
  value: string;
  logic?: "AND" | "OR";
}
```

---

## Authentication Flow

### Login Flow

```
┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
│  Client  │         │  Server  │         │ Cognito  │         │ Database │
└────┬─────┘         └────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                    │                    │
     │ POST /api/auth/login                    │                    │
     │ {email, password}  │                    │                    │
     │───────────────────►│                    │                    │
     │                    │                    │                    │
     │                    │ AdminInitiateAuth  │                    │
     │                    │ (ADMIN_USER_       │                    │
     │                    │  PASSWORD_AUTH)    │                    │
     │                    │───────────────────►│                    │
     │                    │                    │                    │
     │                    │  {accessToken,     │                    │
     │                    │   idToken,         │                    │
     │                    │   refreshToken}    │                    │
     │                    │◄───────────────────│                    │
     │                    │                    │                    │
     │                    │ getUserByEmail()   │                    │
     │                    │───────────────────────────────────────►│
     │                    │                    │                    │
     │                    │ {user + role}      │                    │
     │                    │◄───────────────────────────────────────│
     │                    │                    │                    │
     │ {user, role,       │                    │                    │
     │  accessToken}      │                    │                    │
     │◄───────────────────│                    │                    │
     │                    │                    │                    │
```

### Demo Mode Authentication

When `DEMO_MODE=true` or Cognito is not configured:

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│  Client  │         │  Server  │         │ Database │
└────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                    │
     │ POST /api/auth/login                    │
     │ {email, password}  │                    │
     │───────────────────►│                    │
     │                    │                    │
     │                    │ Generate Demo Token│
     │                    │ (Base64 encoded    │
     │                    │  JSON payload)     │
     │                    │                    │
     │                    │ getUserByEmail()   │
     │                    │───────────────────►│
     │                    │                    │
     │                    │ {user + role}      │
     │                    │◄───────────────────│
     │                    │                    │
     │ {user, role,       │                    │
     │  demoToken}        │                    │
     │◄───────────────────│                    │
```

### Token Verification (Auth Middleware)

```typescript
// File: server/middleware/auth.ts

async function authMiddleware(req, res, next) {
  // 1. Extract Bearer token from Authorization header
  const token = req.headers.authorization?.substring(7);
  
  // 2. Check if demo token or real Cognito token
  if (token.startsWith("demo.")) {
    // Parse and validate demo token
    const payload = parseDemoToken(token);
    // Check expiration
    email = payload.email;
  } else {
    // Verify with Cognito JWT Verifier
    const payload = await cognitoVerifier.verify(token);
    email = payload.username;
  }
  
  // 3. Lookup user and role from database
  const user = await storage.getUserByEmail(email);
  const role = await storage.getRole(user.roleId);
  
  // 4. Attach to request for downstream use
  req.user = { ...user, role };
  next();
}
```

---

## AWS Service Integration

### AWS Client Configuration

All AWS clients are initialized with credentials from environment variables:

```typescript
// Pattern used across all AWS services
const client = new AWSServiceClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
```

### AWS Service Files

| File | Service | Purpose |
|------|---------|---------|
| `server/aws/cognito.ts` | Cognito | User authentication and management |
| `server/aws/iam.ts` | IAM | Role creation with inline policies |
| `server/aws/lakeformation.ts` | Lake Formation | Fine-grained table/column permissions |
| `server/aws/glue.ts` | Glue | Data catalog and schema discovery |
| `server/aws/athena.ts` | Athena | SQL query execution |

### Demo Mode Handling

Each AWS service checks for demo mode and simulates operations:

```typescript
const isDemoMode = process.env.DEMO_MODE === "true" || 
                   !process.env.AWS_ACCESS_KEY_ID;

export async function createIAMRole(roleName, permissions) {
  if (isDemoMode) {
    console.log(`[Demo Mode] Would create IAM role: ${roleName}`);
    return `arn:aws:iam::${accountId}:role/${roleName}`;
  }
  // Real AWS operations...
}
```

---

## Role & Permission Management

### Role Creation Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Admin   │    │  Server  │    │   IAM    │    │   Lake   │    │ Database │
│  Client  │    │          │    │          │    │Formation │    │          │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │               │
     │ POST /api/roles               │               │               │
     │ {name, isAdmin,               │               │               │
     │  permissions}  │               │               │               │
     │──────────────►│               │               │               │
     │               │               │               │               │
     │               │ CreateRole    │               │               │
     │               │ + inline      │               │               │
     │               │ policy        │               │               │
     │               │──────────────►│               │               │
     │               │               │               │               │
     │               │ roleArn       │               │               │
     │               │◄──────────────│               │               │
     │               │               │               │               │
     │               │ BatchGrant    │               │               │
     │               │ Permissions   │               │               │
     │               │ (tables/cols) │               │               │
     │               │──────────────────────────────►│               │
     │               │               │               │               │
     │               │ Insert role   │               │               │
     │               │ with iamRoleArn               │               │
     │               │──────────────────────────────────────────────►│
     │               │               │               │               │
     │ {role}        │               │               │               │
     │◄──────────────│               │               │               │
```

### IAM Role Policy Structure

When a role is created, an IAM role is provisioned with the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AthenaAccess",
      "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults"
      ],
      "Resource": "*"
    },
    {
      "Sid": "GlueAccess",
      "Effect": "Allow",
      "Action": ["glue:GetDatabase", "glue:GetTable", "glue:GetTables"],
      "Resource": [
        "arn:aws:glue:*:ACCOUNT:catalog",
        "arn:aws:glue:*:ACCOUNT:database/crime-data-db",
        "arn:aws:glue:*:ACCOUNT:table/crime-data-db/*"
      ]
    },
    {
      "Sid": "S3ReadAccess",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": "*"
    },
    {
      "Sid": "S3ResultsAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::*athena*/*"
    },
    {
      "Sid": "LakeFormationAccess",
      "Effect": "Allow",
      "Action": ["lakeformation:GetDataAccess"],
      "Resource": "*"
    }
  ]
}
```

### Lake Formation Permissions

Fine-grained access is granted via Lake Formation:

```typescript
// Full table access
{
  Principal: { DataLakePrincipalIdentifier: iamRoleArn },
  Resource: {
    Table: {
      DatabaseName: "crime-data-db",
      Name: "crime_data_prd_silver"
    }
  },
  Permissions: ["SELECT", "DESCRIBE"]
}

// Column-level access
{
  Principal: { DataLakePrincipalIdentifier: iamRoleArn },
  Resource: {
    TableWithColumns: {
      DatabaseName: "insurance-data-db",
      Name: "policy_claims_data_silver",
      ColumnNames: ["claim_id", "claim_amount", "policy_id"]
    }
  },
  Permissions: ["SELECT"]
}
```

---

## Query Execution Flow

### Data Viewer Query Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Client  │    │  Server  │    │  Athena  │    │    S3    │    │   Glue   │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │               │
     │ POST /api/query/execute       │               │               │
     │ {sql, dataSourceId}           │               │               │
     │──────────────►│               │               │               │
     │               │               │               │               │
     │               │ Validate access               │               │
     │               │ to dataSource │               │               │
     │               │               │               │               │
     │               │ Apply row filters             │               │
     │               │ if defined    │               │               │
     │               │               │               │               │
     │               │ StartQuery    │               │               │
     │               │ Execution     │               │               │
     │               │──────────────►│               │               │
     │               │               │               │               │
     │               │ queryId       │               │               │
     │               │◄──────────────│               │               │
     │               │               │               │               │
     │               │ Poll status   │               │               │
     │               │ (GetQueryExec)│               │               │
     │               │──────────────►│               │               │
     │               │               │               │               │
     │               │ SUCCEEDED     │               │               │
     │               │◄──────────────│               │               │
     │               │               │               │               │
     │               │ GetQueryResults               │               │
     │               │──────────────►│               │               │
     │               │               │               │               │
     │               │ {columns,rows}│               │               │
     │               │◄──────────────│               │               │
     │               │               │               │               │
     │ {columns, rows,               │               │               │
     │  executionTimeMs}             │               │               │
     │◄──────────────│               │               │               │
```

### Row Filter Injection

When a role has row-level filters defined, they are automatically injected into the SQL:

```typescript
// Original SQL from user
SELECT * FROM crime_data_prd_silver LIMIT 100

// Role has row filter: city_name = 'Berlin'
// Modified SQL
SELECT * FROM crime_data_prd_silver 
WHERE ("city_name" = 'Berlin') 
LIMIT 100

// If user's SQL already has WHERE clause
SELECT * FROM crime_data_prd_silver WHERE postal_code = '10115'

// Modified SQL (filters combined)
SELECT * FROM crime_data_prd_silver 
WHERE ("city_name" = 'Berlin') AND (postal_code = '10115')
```

---

## Public REST API Flow

### API Key Authentication Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ External │    │  Server  │    │ Database │    │  Athena  │
│  Client  │    │          │    │          │    │          │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │
     │ GET /api/v1/fetch             │               │
     │ Headers:      │               │               │
     │  x-api-key    │               │               │
     │  x-data-source│               │               │
     │──────────────►│               │               │
     │               │               │               │
     │               │ Hash API key  │               │
     │               │ (SHA256)      │               │
     │               │               │               │
     │               │ Lookup by hash│               │
     │               │──────────────►│               │
     │               │               │               │
     │               │ {apiKey, userId}              │
     │               │◄──────────────│               │
     │               │               │               │
     │               │ Get user+role │               │
     │               │──────────────►│               │
     │               │               │               │
     │               │ Validate      │               │
     │               │ permissions   │               │
     │               │               │               │
     │               │ Execute query │               │
     │               │──────────────────────────────►│
     │               │               │               │
     │ JSON or CSV   │               │               │
     │ response      │               │               │
     │◄──────────────│               │               │
```

### API Key Security

```typescript
// Key Generation
const key = `dc4ai_${crypto.randomBytes(32).toString('hex')}`;
// Example: dc4ai_a1b2c3d4e5f6...

// Only the hash is stored in database
const hash = crypto.createHash('sha256').update(key).digest('hex');

// Key prefix stored for display in UI
const prefix = key.substring(0, 12); // "dc4ai_a1b2c3"
```

---

## API Route Summary

### Authentication Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | None | Authenticate user, return tokens |

### Role Management (Admin Only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/roles` | Admin | List all roles |
| GET | `/api/roles/:id` | Admin | Get role by ID |
| POST | `/api/roles` | Admin | Create role (+ IAM + Lake Formation) |
| PATCH | `/api/roles/:id` | Admin | Update role |
| DELETE | `/api/roles/:id` | Admin | Delete role (+ cleanup AWS) |
| GET | `/api/roles/user-counts` | Admin | Get user count per role |

### User Management (Admin Only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/users` | Admin | List all users |
| GET | `/api/users/:id` | Admin | Get user by ID |
| POST | `/api/users` | Admin | Create user (+ Cognito) |
| PATCH | `/api/users/:id` | Admin | Update user |
| DELETE | `/api/users/:id` | Admin | Delete user (+ Cognito) |

### Data & Query Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/data-sources/schemas` | User | Get all data source schemas from Glue |
| GET | `/api/data-sources/:id/columns` | User | Get columns for specific data source |
| POST | `/api/query/execute` | User | Execute SQL query via Athena |

### API Key Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/api-keys` | User | List user's API keys |
| POST | `/api/api-keys` | User | Generate new API key |
| DELETE | `/api/api-keys/:id` | User | Revoke API key |

### Public REST API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/fetch` | API Key | Fetch data with role permissions |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AWS_REGION` | Yes | AWS region (e.g., eu-central-1) |
| `AWS_ACCESS_KEY_ID` | Yes | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS credentials |
| `AWS_ACCOUNT_ID` | Yes | AWS account ID for IAM ARNs |
| `COGNITO_USER_POOL_ID` | Yes* | Cognito user pool ID |
| `COGNITO_CLIENT_ID` | Yes* | Cognito app client ID |
| `ATHENA_OUTPUT_LOCATION` | Yes | S3 path for query results |
| `DEMO_MODE` | No | Set to "true" to bypass AWS |
| `SESSION_SECRET` | Yes | Session encryption key |

*Required unless `DEMO_MODE=true`

---

## Data Sources

| ID | Name | Table Name |
|----|------|------------|
| `crime-data-db` | Crime Data | `crime_data_prd_silver` |
| `events-data-db` | Events Data | `event_data_prd_silver` |
| `insurance-data-db` | Insurance Data | `policy_claims_data_silver` |
| `traffic-data-db` | Traffic Data | `traffic_data_prd_silver` |
| `weather-data-db` | Weather Data | `weather_data_prd_silver` |
