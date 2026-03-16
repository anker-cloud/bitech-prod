# Bitech DC4AI - Data Collection 4 Artificial Intelligence

## Overview

This is the Bitech DC4AI (Data Collection 4 Artificial Intelligence) platform that provides role-based access control for querying AWS data sources. The application enables administrators to manage users and roles with granular permissions to different data sources (Crime, Events, Traffic, Weather), while regular users can query data through either a visual query builder or custom SQL interface. The system integrates with AWS services including Cognito for authentication, Athena for query execution, Glue for schema discovery, Lake Formation for permissions, and IAM for role management.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state, React Context for auth state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom theme configuration supporting light/dark modes
- **Build Tool**: Vite for development and production builds

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **API Design**: RESTful JSON API with Bearer token authentication
- **Authentication Middleware**: JWT verification using AWS Cognito tokens

### Data Storage
- **Primary Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Tables**: 
  - `roles` - Role definitions with JSON permissions for data source access
  - `users` - User accounts linked to roles and Cognito
  - `queryHistory` - Audit log of executed queries
  - `apiKeys` - API keys for programmatic data access (SHA256 hashed, revocable)

### Authentication Flow
1. User submits credentials to `/api/auth/login`
2. Backend authenticates via AWS Cognito using ADMIN_USER_PASSWORD_AUTH
3. JWT tokens returned and stored in localStorage
4. Subsequent API requests include Bearer token in Authorization header
5. Auth middleware validates Cognito JWT tokens and attaches user context

### Initial Setup Flow
When no users exist in the system:
1. App detects empty users table via `/api/setup/status`
2. Displays Setup page instead of Login page
3. Admin creates first user via `/api/setup/admin` endpoint
4. User is created in both Cognito and app database
5. Automatic login after setup complete

### Permission Model
- Roles define access to data sources with table, column, and row-level granularity
- Each role has a `permissions` array containing `DataSourcePermission` objects
- Table permissions include:
  - **Column Access**: `allColumns` toggle or specific column selection
  - **Row Access**: `allRows` toggle or row filters with conditions (column, operator, value, AND/OR logic)
- Supported row filter operators: equals (=), not_equals (!=), contains (LIKE), greater_than (>), less_than (<), in (IN)
- Row filters are automatically injected into SQL queries at execution time
- **German Character Normalization**: All string-based filters (equals, not_equals, contains, in) automatically normalize German umlauts (ä→a, ö→o, ü→u, Ä→A, Ö→O, Ü→U, ß→ss) and are case-insensitive. This applies to the UI query builder, permission-based row filters, and the public REST API. The normalization utility is in `shared/sql-normalize.ts`.
- Admin roles bypass all data source restrictions
- IAM roles and Lake Formation permissions sync with application roles

## External Dependencies

### AWS Services
- **Cognito**: User authentication and token management (`@aws-sdk/client-cognito-identity-provider`)
- **Athena**: SQL query execution against data sources (`@aws-sdk/client-athena`)
- **Glue**: Data catalog for schema discovery (`@aws-sdk/client-glue`)
- **Lake Formation**: Fine-grained data access control (`@aws-sdk/client-lakeformation`)
- **IAM**: Role creation for data access policies (`@aws-sdk/client-iam`)
- **S3**: Query result storage (`@aws-sdk/client-s3`)

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string
- `AWS_REGION` - AWS region for services (default: eu-central-1)
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `COGNITO_USER_POOL_ID` - Cognito user pool identifier
- `COGNITO_CLIENT_ID` - Cognito app client identifier (must have ADMIN_USER_PASSWORD_AUTH enabled)
- `AWS_ACCOUNT_ID` - AWS account for IAM role ARNs
- `ATHENA_OUTPUT_LOCATION` - S3 bucket for query results

### AWS Cognito Requirements
The Cognito User Pool client must have:
- `ADMIN_USER_PASSWORD_AUTH` auth flow enabled
- App client configured for server-side authentication

### AWS Glue Catalog Structure
The platform uses two consolidated Glue databases (staging and prod), each containing all data source tables:
- **Staging**: `bitech_staging_db` (used when `NODE_ENV !== 'production'`)
- **Production**: `bitech_prod_db` (used when `NODE_ENV === 'production'`)

Tables (same names in both databases):
- `crime_data_silver` — Crime statistics and incident data
- `events_data_silver` — Event scheduling and tracking data
- `policy_claims_data_silver` — Insurance policy and claims data
- `traffic_data_silver` — Traffic flow and incident data
- `weather_data_silver` — Weather conditions and forecasts

The active database is resolved at runtime by `server/aws/config.ts`. All Athena queries, Glue schema discovery, and Lake Formation permissions automatically target the correct database.

### Athena Configuration
- Output Location: `s3://bitech-pbac-data-prd/athena-post-op/`
- Workgroup: Uses default settings from AWS account

### Public REST API
The platform provides a public REST API for programmatic data access:
- **Endpoint**: `GET /api/v1/fetch`
- **Authentication**: `x-api-key` header with API key generated from the API Keys page
- **Headers**:
  - `x-api-key` (required) - API key for authentication
  - `x-data-source` (required) - Short name: `crime`, `events`, `insurance`, `traffic`, `weather` (legacy IDs like `crime-data-db` also accepted)
  - `Accept` - Response format: `application/json` (default) or `text/csv`
- **Query Parameters**:
  - `columns` - Comma-separated column names (optional, returns all allowed columns if omitted)
  - `limit` - Max rows to return (default: 100, max: 1000)
  - Any other parameter is treated as an equals filter (e.g., `city_name=Berlin`)
- **Security**:
  - API keys are SHA256 hashed in the database
  - Keys inherit the user's role permissions (column/row restrictions apply)
  - Keys can be revoked at any time from the API Keys page
- **Note**: Athena does not support OFFSET, so pagination is limited to LIMIT only