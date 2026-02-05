# Bitech DC4AI - AWS Deployment Guide

This guide provides step-by-step instructions for deploying the DC4AI platform on AWS, replicating the functionality currently running on Replit.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Networking (VPC)](#step-1-networking-vpc)
4. [Step 2: Database (RDS PostgreSQL)](#step-2-database-rds-postgresql)
5. [Step 3: Compute (ECS Fargate or EC2)](#step-3-compute-ecs-fargate-or-ec2)
6. [Step 4: Container Registry (ECR)](#step-4-container-registry-ecr)
7. [Step 5: Load Balancer (ALB)](#step-5-load-balancer-alb)
8. [Step 6: SSL/TLS Certificates (ACM)](#step-6-ssltls-certificates-acm)
9. [Step 7: Secrets Management (Secrets Manager)](#step-7-secrets-management-secrets-manager)
10. [Step 8: CI/CD Pipeline (CodePipeline + CodeBuild)](#step-8-cicd-pipeline-codepipeline--codebuild)
11. [Step 9: Domain & DNS (Route 53)](#step-9-domain--dns-route-53)
12. [Step 10: Monitoring & Logging (CloudWatch)](#step-10-monitoring--logging-cloudwatch)
13. [Step 11: IAM Roles & Policies](#step-11-iam-roles--policies)
14. [Cost Estimation](#cost-estimation)
15. [Security Best Practices](#security-best-practices)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                       │
│                                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐   │
│  │  Route 53   │────▶│     ALB     │────▶│    ECS Fargate Cluster      │   │
│  │  (DNS)      │     │ (HTTPS:443) │     │  ┌─────────────────────┐    │   │
│  └─────────────┘     └─────────────┘     │  │   DC4AI Container   │    │   │
│                             │            │  │  (Node.js + React)  │    │   │
│  ┌─────────────┐           │            │  └─────────────────────┘    │   │
│  │    ACM      │───────────┘            └─────────────────────────────┘   │
│  │ (SSL Cert)  │                                     │                     │
│  └─────────────┘                                     ▼                     │
│                                          ┌─────────────────────┐           │
│  ┌─────────────┐                        │   RDS PostgreSQL    │           │
│  │   Secrets   │◀───────────────────────│   (Private Subnet)  │           │
│  │   Manager   │                        └─────────────────────┘           │
│  └─────────────┘                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Existing AWS Data Services                        │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │   │
│  │  │ Cognito │  │  Glue   │  │ Athena  │  │   S3    │  │  Lake   │   │   │
│  │  │         │  │ Catalog │  │         │  │ Buckets │  │Formation│   │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         CI/CD Pipeline                               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                │   │
│  │  │ GitHub  │──│CodePipe │──│CodeBuild│──│   ECR   │                │   │
│  │  │         │  │  line   │  │         │  │         │                │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

Before starting, ensure you have:

- [ ] AWS Account with administrator access
- [ ] AWS CLI installed and configured (`aws configure`)
- [ ] Docker installed locally (for building images)
- [ ] Domain name (optional, for custom domain)
- [ ] Git repository (GitHub, GitLab, or CodeCommit)

**Existing AWS Services Required:**
- Cognito User Pool (already configured)
- Glue Data Catalog with databases (crime-data-db, events-data-db, etc.)
- Athena workgroup
- S3 buckets for Athena query results
- Lake Formation configured

---

## Step 1: Networking (VPC)

### Create VPC with Public and Private Subnets

```bash
# Create VPC
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=dc4ai-vpc}]'
```

**Required Resources:**

| Resource | Configuration | Purpose |
|----------|---------------|---------|
| VPC | 10.0.0.0/16 | Main network |
| Public Subnet 1 | 10.0.1.0/24 (AZ-a) | ALB, NAT Gateway |
| Public Subnet 2 | 10.0.2.0/24 (AZ-b) | ALB (multi-AZ) |
| Private Subnet 1 | 10.0.10.0/24 (AZ-a) | ECS Tasks, RDS |
| Private Subnet 2 | 10.0.11.0/24 (AZ-b) | ECS Tasks, RDS (multi-AZ) |
| Internet Gateway | Attached to VPC | Public internet access |
| NAT Gateway | In public subnet | Outbound for private subnets |
| Route Tables | Public & Private | Traffic routing |

### Security Groups

**1. ALB Security Group:**
```
Inbound:
- Port 443 (HTTPS) from 0.0.0.0/0
- Port 80 (HTTP) from 0.0.0.0/0 (redirect to HTTPS)

Outbound:
- All traffic to VPC CIDR
```

**2. ECS Tasks Security Group:**
```
Inbound:
- Port 5000 from ALB Security Group

Outbound:
- Port 5432 to RDS Security Group
- Port 443 to 0.0.0.0/0 (AWS APIs)
```

**3. RDS Security Group:**
```
Inbound:
- Port 5432 from ECS Tasks Security Group

Outbound:
- None required
```

---

## Step 2: Database (RDS PostgreSQL)

### Create RDS PostgreSQL Instance

```bash
# Create DB subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name dc4ai-db-subnet \
  --db-subnet-group-description "DC4AI Database subnets" \
  --subnet-ids subnet-xxx subnet-yyy

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier dc4ai-postgres \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15 \
  --master-username dc4ai_admin \
  --master-user-password <secure-password> \
  --allocated-storage 20 \
  --db-subnet-group-name dc4ai-db-subnet \
  --vpc-security-group-ids sg-xxx \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --storage-encrypted
```

**Configuration:**

| Setting | Value | Notes |
|---------|-------|-------|
| Engine | PostgreSQL 15 | Same as Replit |
| Instance Class | db.t3.micro (dev) / db.t3.small (prod) | Start small, scale up |
| Storage | 20 GB gp3 | Auto-scaling enabled |
| Multi-AZ | Optional for prod | High availability |
| Encryption | Enabled | At-rest encryption |
| Backup | 7 days retention | Point-in-time recovery |

### Initialize Database Schema

After RDS is running, connect and run the Drizzle migrations:

```bash
# Get RDS endpoint
aws rds describe-db-instances \
  --db-instance-identifier dc4ai-postgres \
  --query 'DBInstances[0].Endpoint.Address'

# Run from bastion host or local with VPN
DATABASE_URL="postgresql://dc4ai_admin:password@endpoint:5432/dc4ai" \
npm run db:push
```

---

## Step 3: Compute (ECS Fargate or EC2)

### Option A: ECS Fargate (Recommended - Serverless)

**Create ECS Cluster:**
```bash
aws ecs create-cluster \
  --cluster-name dc4ai-cluster \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy \
    capacityProvider=FARGATE,weight=1,base=1
```

**Task Definition (task-definition.json):**
```json
{
  "family": "dc4ai-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/dc4ai-task-role",
  "containerDefinitions": [
    {
      "name": "dc4ai-app",
      "image": "ACCOUNT.dkr.ecr.REGION.amazonaws.com/dc4ai:latest",
      "portMappings": [
        {
          "containerPort": 5000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "AWS_REGION", "value": "eu-central-1"}
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:dc4ai/database-url"
        },
        {
          "name": "SESSION_SECRET",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:dc4ai/session-secret"
        },
        {
          "name": "COGNITO_USER_POOL_ID",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:dc4ai/cognito-pool-id"
        },
        {
          "name": "COGNITO_CLIENT_ID",
          "valueFrom": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:dc4ai/cognito-client-id"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/dc4ai",
          "awslogs-region": "eu-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:5000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

**Create ECS Service:**
```bash
aws ecs create-service \
  --cluster dc4ai-cluster \
  --service-name dc4ai-service \
  --task-definition dc4ai-app \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=dc4ai-app,containerPort=5000"
```

### Option B: EC2 (Traditional)

| Setting | Value |
|---------|-------|
| Instance Type | t3.small (2 vCPU, 2GB RAM) |
| AMI | Amazon Linux 2023 |
| Storage | 20 GB gp3 |
| Auto Scaling | Min: 1, Max: 4, Desired: 2 |

---

## Step 4: Container Registry (ECR)

### Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name dc4ai \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256
```

### Dockerfile (create in project root)

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Copy built assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
```

### Build and Push

```bash
# Login to ECR
aws ecr get-login-password --region eu-central-1 | \
  docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com

# Build image
docker build -t dc4ai .

# Tag and push
docker tag dc4ai:latest ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com/dc4ai:latest
docker push ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com/dc4ai:latest
```

---

## Step 5: Load Balancer (ALB)

### Create Application Load Balancer

```bash
# Create ALB
aws elbv2 create-load-balancer \
  --name dc4ai-alb \
  --subnets subnet-xxx subnet-yyy \
  --security-groups sg-xxx \
  --scheme internet-facing \
  --type application

# Create target group
aws elbv2 create-target-group \
  --name dc4ai-targets \
  --protocol HTTP \
  --port 5000 \
  --vpc-id vpc-xxx \
  --target-type ip \
  --health-check-path /api/health \
  --health-check-interval-seconds 30

# Create HTTPS listener (after ACM certificate)
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:... \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:...

# Create HTTP to HTTPS redirect
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:... \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=redirect,RedirectConfig="{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"
```

---

## Step 6: SSL/TLS Certificates (ACM)

### Request Certificate

```bash
aws acm request-certificate \
  --domain-name dc4ai.yourdomain.com \
  --validation-method DNS \
  --subject-alternative-names "*.dc4ai.yourdomain.com"
```

### Validate Certificate

1. Go to ACM Console
2. Click on the certificate
3. Create the CNAME record in Route 53 or your DNS provider
4. Wait for validation (usually 5-30 minutes)

---

## Step 7: Secrets Management (Secrets Manager)

### Create Secrets

```bash
# Database URL
aws secretsmanager create-secret \
  --name dc4ai/database-url \
  --secret-string "postgresql://user:pass@endpoint:5432/dc4ai"

# Session Secret
aws secretsmanager create-secret \
  --name dc4ai/session-secret \
  --secret-string "your-secure-session-secret-here"

# Cognito User Pool ID
aws secretsmanager create-secret \
  --name dc4ai/cognito-pool-id \
  --secret-string "eu-central-1_xxxxxxx"

# Cognito Client ID
aws secretsmanager create-secret \
  --name dc4ai/cognito-client-id \
  --secret-string "xxxxxxxxxxxxxxxxxxxxxxxxxx"

# Athena Output Location
aws secretsmanager create-secret \
  --name dc4ai/athena-output \
  --secret-string "s3://bitech-pbac-data-prd/athena-post-op/"
```

**All Required Secrets:**

| Secret Name | Description |
|-------------|-------------|
| dc4ai/database-url | PostgreSQL connection string |
| dc4ai/session-secret | Express session encryption key |
| dc4ai/cognito-pool-id | Cognito User Pool ID |
| dc4ai/cognito-client-id | Cognito App Client ID |
| dc4ai/athena-output | S3 bucket for Athena results |
| dc4ai/aws-access-key | AWS access key (if not using IAM roles) |
| dc4ai/aws-secret-key | AWS secret key (if not using IAM roles) |

---

## Step 8: CI/CD Pipeline (CodePipeline + CodeBuild)

### buildspec.yml (create in project root)

```yaml
version: 0.2

env:
  variables:
    ECR_REPO: dc4ai
    AWS_REGION: eu-central-1
  secrets-manager:
    DOCKERHUB_USERNAME: dockerhub:username
    DOCKERHUB_PASSWORD: dockerhub:password

phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO
      - COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)
      - IMAGE_TAG=${COMMIT_HASH:=latest}
      
  build:
    commands:
      - echo Build started on `date`
      - echo Building the Docker image...
      - docker build -t $REPOSITORY_URI:latest .
      - docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG
      
  post_build:
    commands:
      - echo Build completed on `date`
      - echo Pushing the Docker images...
      - docker push $REPOSITORY_URI:latest
      - docker push $REPOSITORY_URI:$IMAGE_TAG
      - echo Writing image definitions file...
      - printf '[{"name":"dc4ai-app","imageUri":"%s"}]' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
```

### Create CodePipeline

```bash
# Create CodeBuild project
aws codebuild create-project \
  --name dc4ai-build \
  --source type=GITHUB,location=https://github.com/org/dc4ai.git \
  --environment type=LINUX_CONTAINER,computeType=BUILD_GENERAL1_SMALL,image=aws/codebuild/amazonlinux2-x86_64-standard:5.0,privilegedMode=true \
  --service-role arn:aws:iam::ACCOUNT:role/codebuild-role \
  --artifacts type=NO_ARTIFACTS

# Create CodePipeline
aws codepipeline create-pipeline --pipeline file://pipeline.json
```

### pipeline.json

```json
{
  "pipeline": {
    "name": "dc4ai-pipeline",
    "roleArn": "arn:aws:iam::ACCOUNT:role/codepipeline-role",
    "stages": [
      {
        "name": "Source",
        "actions": [
          {
            "name": "Source",
            "actionTypeId": {
              "category": "Source",
              "owner": "AWS",
              "provider": "CodeStarSourceConnection",
              "version": "1"
            },
            "configuration": {
              "ConnectionArn": "arn:aws:codestar-connections:...",
              "FullRepositoryId": "org/dc4ai",
              "BranchName": "main"
            },
            "outputArtifacts": [{"name": "SourceOutput"}]
          }
        ]
      },
      {
        "name": "Build",
        "actions": [
          {
            "name": "Build",
            "actionTypeId": {
              "category": "Build",
              "owner": "AWS",
              "provider": "CodeBuild",
              "version": "1"
            },
            "configuration": {
              "ProjectName": "dc4ai-build"
            },
            "inputArtifacts": [{"name": "SourceOutput"}],
            "outputArtifacts": [{"name": "BuildOutput"}]
          }
        ]
      },
      {
        "name": "Deploy",
        "actions": [
          {
            "name": "Deploy",
            "actionTypeId": {
              "category": "Deploy",
              "owner": "AWS",
              "provider": "ECS",
              "version": "1"
            },
            "configuration": {
              "ClusterName": "dc4ai-cluster",
              "ServiceName": "dc4ai-service",
              "FileName": "imagedefinitions.json"
            },
            "inputArtifacts": [{"name": "BuildOutput"}]
          }
        ]
      }
    ]
  }
}
```

---

## Step 9: Domain & DNS (Route 53)

### Create Hosted Zone (if not exists)

```bash
aws route53 create-hosted-zone \
  --name dc4ai.yourdomain.com \
  --caller-reference $(date +%s)
```

### Create A Record for ALB

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id ZXXXXX \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "dc4ai.yourdomain.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "ALB_HOSTED_ZONE_ID",
          "DNSName": "dc4ai-alb-xxx.eu-central-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

---

## Step 10: Monitoring & Logging (CloudWatch)

### Create Log Group

```bash
aws logs create-log-group --log-group-name /ecs/dc4ai
aws logs put-retention-policy --log-group-name /ecs/dc4ai --retention-in-days 30
```

### Create CloudWatch Dashboard

```bash
aws cloudwatch put-dashboard \
  --dashboard-name DC4AI-Dashboard \
  --dashboard-body file://dashboard.json
```

### Create Alarms

```bash
# CPU Utilization Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name dc4ai-high-cpu \
  --alarm-description "ECS CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ClusterName,Value=dc4ai-cluster Name=ServiceName,Value=dc4ai-service \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:REGION:ACCOUNT:alerts

# 5XX Error Alarm
aws cloudwatch put-metric-alarm \
  --alarm-name dc4ai-5xx-errors \
  --alarm-description "ALB 5XX errors > 10" \
  --metric-name HTTPCode_Target_5XX_Count \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 60 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=LoadBalancer,Value=app/dc4ai-alb/xxx \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:REGION:ACCOUNT:alerts
```

---

## Step 11: IAM Roles & Policies

### ECS Task Execution Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ecs/dc4ai:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:dc4ai/*"
    }
  ]
}
```

### ECS Task Role (Application Permissions)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CognitoAdmin",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminInitiateAuth",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminSetUserPassword"
      ],
      "Resource": "arn:aws:cognito-idp:*:*:userpool/*"
    },
    {
      "Sid": "GlueReadOnly",
      "Effect": "Allow",
      "Action": [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetPartitions"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AthenaQuery",
      "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:StopQueryExecution"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3AthenaResults",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::bitech-pbac-data-prd/athena-post-op/*",
        "arn:aws:s3:::bitech-pbac-data-prd"
      ]
    },
    {
      "Sid": "S3DataRead",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::bitech-*",
        "arn:aws:s3:::bitech-*/*"
      ]
    },
    {
      "Sid": "LakeFormation",
      "Effect": "Allow",
      "Action": [
        "lakeformation:GetDataAccess",
        "lakeformation:GrantPermissions",
        "lakeformation:RevokePermissions"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy"
      ],
      "Resource": "arn:aws:iam::*:role/DC4AI-*"
    }
  ]
}
```

### CodeBuild Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::codepipeline-*"
    }
  ]
}
```

---

## Cost Estimation

### Monthly Cost Breakdown (Production)

| Service | Configuration | Estimated Cost |
|---------|---------------|----------------|
| ECS Fargate | 2 tasks, 0.5 vCPU, 1GB each | ~$30/month |
| RDS PostgreSQL | db.t3.small, 20GB | ~$25/month |
| ALB | 1 ALB + data transfer | ~$20/month |
| NAT Gateway | 1 per AZ (2 total) | ~$65/month |
| Route 53 | 1 hosted zone | ~$0.50/month |
| ECR | Image storage | ~$1/month |
| Secrets Manager | 7 secrets | ~$3/month |
| CloudWatch | Logs + metrics | ~$10/month |
| CodePipeline | 1 pipeline | $1/month |
| CodeBuild | Build minutes | ~$5/month |
| **Total** | | **~$160/month** |

### Development Environment (Cost-Optimized)

| Service | Configuration | Estimated Cost |
|---------|---------------|----------------|
| ECS Fargate Spot | 1 task | ~$10/month |
| RDS PostgreSQL | db.t3.micro | ~$15/month |
| ALB | Shared with other apps | ~$15/month |
| NAT Gateway | 1 only | ~$32/month |
| Other services | Same as prod | ~$20/month |
| **Total** | | **~$92/month** |

---

## Security Best Practices

### Network Security
- [ ] All database traffic through private subnets only
- [ ] Security groups with least-privilege access
- [ ] VPC Flow Logs enabled
- [ ] No public IPs on ECS tasks or RDS

### Application Security
- [ ] All secrets in AWS Secrets Manager
- [ ] No hardcoded credentials in code or environment
- [ ] Container images scanned on push
- [ ] HTTPS only (HTTP redirects to HTTPS)

### Access Control
- [ ] IAM roles follow least-privilege principle
- [ ] MFA enabled for all IAM users
- [ ] Regular rotation of secrets
- [ ] CloudTrail enabled for audit

### Monitoring
- [ ] CloudWatch alarms for critical metrics
- [ ] Log retention policies configured
- [ ] SNS alerts for security events
- [ ] Regular review of access logs

---

## Quick Start Checklist

1. [ ] Create VPC with public/private subnets
2. [ ] Create security groups
3. [ ] Create RDS PostgreSQL instance
4. [ ] Create ECR repository
5. [ ] Build and push Docker image
6. [ ] Create secrets in Secrets Manager
7. [ ] Create ECS cluster and service
8. [ ] Create ALB with target group
9. [ ] Request and validate ACM certificate
10. [ ] Configure ALB listeners (HTTP redirect, HTTPS)
11. [ ] Create Route 53 record
12. [ ] Create CloudWatch log group and alarms
13. [ ] Set up CodePipeline for CI/CD
14. [ ] Test the deployment
15. [ ] Enable production monitoring

---

## Troubleshooting

### Common Issues

**Container fails to start:**
- Check CloudWatch logs: `/ecs/dc4ai`
- Verify secrets are accessible
- Check security group allows outbound HTTPS

**Database connection fails:**
- Verify RDS security group allows port 5432 from ECS
- Check DATABASE_URL format in secrets
- Ensure RDS is in same VPC as ECS

**Health checks failing:**
- Verify `/api/health` endpoint exists
- Check target group health check settings
- Review ALB access logs

**Athena queries fail:**
- Verify S3 bucket permissions
- Check Glue database access
- Review Lake Formation permissions

---

## Support Resources

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS RDS PostgreSQL Guide](https://docs.aws.amazon.com/rds/)
- [AWS CodePipeline User Guide](https://docs.aws.amazon.com/codepipeline/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
