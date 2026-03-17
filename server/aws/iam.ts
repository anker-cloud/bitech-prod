import {
  IAMClient,
  CreateRoleCommand,
  DeleteRoleCommand,
  PutRolePolicyCommand,
  DeleteRolePolicyCommand,
  GetRoleCommand,
} from "@aws-sdk/client-iam";
import type { DataSourcePermission } from "@shared/schema";

const client = new IAMClient({
  region: process.env.AWS_REGION || "eu-central-1",
});

const accountId = process.env.AWS_ACCOUNT_ID || "123456789012";

function getRoleNameFromAppRole(roleName: string): string {
  return `DataAccessPlatform-${roleName.replace(/\s+/g, "-")}`;
}

export async function createIAMRole(roleName: string, permissions: DataSourcePermission[]): Promise<string> {
  const iamRoleName = getRoleNameFromAppRole(roleName);
  
  const assumeRolePolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Service: ["lakeformation.amazonaws.com", "glue.amazonaws.com"],
        },
        Action: "sts:AssumeRole",
      },
    ],
  };

  const createRoleCommand = new CreateRoleCommand({
    RoleName: iamRoleName,
    AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
    Description: `Data Access Platform role for ${roleName}`,
    Tags: [
      { Key: "Application", Value: "DataAccessPlatform" },
      { Key: "RoleName", Value: roleName },
    ],
  });

  const response = await client.send(createRoleCommand);
  const roleArn = response.Role?.Arn;

  if (!roleArn) {
    throw new Error("Failed to create IAM role");
  }

  const accessibleDatabases = permissions
    .filter(p => p.hasAccess)
    .map(p => p.dataSourceId);

  const inlinePolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AthenaAccess",
        Effect: "Allow",
        Action: [
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:GetWorkGroup",
          "athena:ListWorkGroups",
        ],
        Resource: "*",
      },
      {
        Sid: "GlueAccess",
        Effect: "Allow",
        Action: [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
        ],
        Resource: accessibleDatabases.length > 0 
          ? accessibleDatabases.flatMap(db => [
              `arn:aws:glue:*:${accountId}:catalog`,
              `arn:aws:glue:*:${accountId}:database/${db}`,
              `arn:aws:glue:*:${accountId}:table/${db}/*`,
            ])
          : [`arn:aws:glue:*:${accountId}:catalog`],
      },
      {
        Sid: "S3ReadAccess",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
        ],
        Resource: "*",
      },
      {
        Sid: "S3ResultsAccess",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:AbortMultipartUpload",
        ],
        Resource: "arn:aws:s3:::*athena*/*",
      },
      {
        Sid: "LakeFormationAccess",
        Effect: "Allow",
        Action: [
          "lakeformation:GetDataAccess",
        ],
        Resource: "*",
      },
    ],
  };

  const putPolicyCommand = new PutRolePolicyCommand({
    RoleName: iamRoleName,
    PolicyName: "DataAccessPolicy",
    PolicyDocument: JSON.stringify(inlinePolicy),
  });

  await client.send(putPolicyCommand);

  return roleArn;
}

export async function updateIAMRole(roleName: string, permissions: DataSourcePermission[]): Promise<void> {
  const iamRoleName = getRoleNameFromAppRole(roleName);

  const accessibleDatabases = permissions
    .filter(p => p.hasAccess)
    .map(p => p.dataSourceId);

  const inlinePolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AthenaAccess",
        Effect: "Allow",
        Action: [
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:GetWorkGroup",
          "athena:ListWorkGroups",
        ],
        Resource: "*",
      },
      {
        Sid: "GlueAccess",
        Effect: "Allow",
        Action: [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
        ],
        Resource: accessibleDatabases.length > 0 
          ? accessibleDatabases.flatMap(db => [
              `arn:aws:glue:*:*:catalog`,
              `arn:aws:glue:*:*:database/${db}`,
              `arn:aws:glue:*:*:table/${db}/*`,
            ])
          : [`arn:aws:glue:*:*:catalog`],
      },
      {
        Sid: "S3ReadAccess",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
        ],
        Resource: "*",
      },
      {
        Sid: "S3ResultsAccess",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:AbortMultipartUpload",
        ],
        Resource: "arn:aws:s3:::*athena*/*",
      },
      {
        Sid: "LakeFormationAccess",
        Effect: "Allow",
        Action: [
          "lakeformation:GetDataAccess",
        ],
        Resource: "*",
      },
    ],
  };

  const putPolicyCommand = new PutRolePolicyCommand({
    RoleName: iamRoleName,
    PolicyName: "DataAccessPolicy",
    PolicyDocument: JSON.stringify(inlinePolicy),
  });

  await client.send(putPolicyCommand);
}

export async function deleteIAMRole(roleName: string): Promise<void> {
  const iamRoleName = getRoleNameFromAppRole(roleName);

  try {
    const deletePolicyCommand = new DeleteRolePolicyCommand({
      RoleName: iamRoleName,
      PolicyName: "DataAccessPolicy",
    });
    await client.send(deletePolicyCommand);
  } catch (error) {
  }

  const deleteRoleCommand = new DeleteRoleCommand({
    RoleName: iamRoleName,
  });

  await client.send(deleteRoleCommand);
}

export async function getIAMRole(roleName: string): Promise<string | null> {
  const iamRoleName = getRoleNameFromAppRole(roleName);

  try {
    const command = new GetRoleCommand({
      RoleName: iamRoleName,
    });

    const response = await client.send(command);
    return response.Role?.Arn || null;
  } catch (error) {
    return null;
  }
}
