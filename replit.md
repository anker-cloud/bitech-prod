# Bitech Data Access Platform

## Overview

This is the Bitech enterprise data access platform that provides role-based access control for querying AWS data sources. The application enables administrators to manage users and roles with granular permissions to different data sources (Crime, Events, Traffic, Weather), while regular users can query data through either a visual query builder or custom SQL interface. The system integrates with AWS services including Cognito for authentication, Athena for query execution, Glue for schema discovery, Lake Formation for permissions, and IAM for role management.

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
- **Authentication Middleware**: JWT verification supporting both AWS Cognito tokens and demo mode tokens

### Data Storage
- **Primary Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Tables**: 
  - `roles` - Role definitions with JSON permissions for data source access
  - `users` - User accounts linked to roles and Cognito
  - `queryHistory` - Audit log of executed queries

### Authentication Flow
1. User submits credentials to `/api/auth/login`
2. Backend authenticates via AWS Cognito (or demo mode)
3. JWT tokens returned and stored in localStorage
4. Subsequent API requests include Bearer token in Authorization header
5. Auth middleware validates tokens and attaches user context

### Permission Model
- Roles define access to data sources with table and column-level granularity
- Each role has a `permissions` array containing `DataSourcePermission` objects
- Admin roles bypass data source restrictions
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
- `AWS_REGION` - AWS region for services
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `COGNITO_USER_POOL_ID` - Cognito user pool identifier
- `COGNITO_CLIENT_ID` - Cognito app client identifier
- `AWS_ACCOUNT_ID` - AWS account for IAM role ARNs
- `ATHENA_OUTPUT_LOCATION` - S3 bucket for query results
- `DEMO_MODE` - Set to "true" to bypass AWS integrations

### Hybrid Mode (Current Configuration)
The platform operates in hybrid mode:
- **Authentication**: Demo mode (`DEMO_MODE=true`) - Uses demo tokens due to AWS Cognito ADMIN_USER_PASSWORD_AUTH not being enabled on the user pool client
- **Data Operations**: Real AWS services - Glue for schema discovery, Athena for query execution, S3 for result storage

### AWS Glue Catalog Structure
The platform connects to the following real AWS Glue databases and tables:
- `crime-data-db` → `crime_data_prd_silver` (columns: location, latitude, longitude, postal_code, city_name, date_time, title, link, description)
- `events-data-db` → `event_data_prd_silver`
- `traffic-data-db` → `traffic_data_prd_silver`
- `weather-data-db` → `weather_data_prd_silver`

### Athena Configuration
- Output Location: `s3://bitech-pbac-data-prd/athena-post-op/`
- Workgroup: Uses default settings from AWS account