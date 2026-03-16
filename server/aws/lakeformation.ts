import {
  LakeFormationClient,
  GrantPermissionsCommand,
  RevokePermissionsCommand,
  BatchGrantPermissionsCommand,
  BatchRevokePermissionsCommand,
  GetResourceLFTagsCommand,
  Permission,
} from "@aws-sdk/client-lakeformation";
import type { DataSourcePermission } from "@shared/schema";
import { getActiveDatabase } from "./config";

const client = new LakeFormationClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function grantLakeFormationPermissions(
  iamRoleArn: string,
  permissions: DataSourcePermission[]
): Promise<void> {
  const entries = [];
  const activeDb = getActiveDatabase();

  for (const permission of permissions) {
    if (!permission.hasAccess) continue;

    for (const table of permission.tables) {
      if (table.allColumns) {
        entries.push({
          Id: `${permission.dataSourceId}-${table.tableName}`,
          Principal: {
            DataLakePrincipalIdentifier: iamRoleArn,
          },
          Resource: {
            Table: {
              DatabaseName: activeDb,
              Name: table.tableName,
            },
          },
          Permissions: [Permission.SELECT, Permission.DESCRIBE],
        });
      } else if (table.columns.length > 0) {
        entries.push({
          Id: `${permission.dataSourceId}-${table.tableName}-columns`,
          Principal: {
            DataLakePrincipalIdentifier: iamRoleArn,
          },
          Resource: {
            TableWithColumns: {
              DatabaseName: activeDb,
              Name: table.tableName,
              ColumnNames: table.columns,
            },
          },
          Permissions: [Permission.SELECT],
        });
      }
    }
  }

  if (entries.length === 0) return;

  const command = new BatchGrantPermissionsCommand({
    CatalogId: process.env.AWS_ACCOUNT_ID,
    Entries: entries,
  });

  await client.send(command);
}

export async function revokeLakeFormationPermissions(
  iamRoleArn: string,
  permissions: DataSourcePermission[]
): Promise<void> {
  const entries = [];
  const activeDb = getActiveDatabase();

  for (const permission of permissions) {
    for (const table of permission.tables) {
      entries.push({
        Id: `${permission.dataSourceId}-${table.tableName}`,
        Principal: {
          DataLakePrincipalIdentifier: iamRoleArn,
        },
        Resource: {
          Table: {
            DatabaseName: activeDb,
            Name: table.tableName,
          },
        },
        Permissions: [Permission.SELECT, Permission.DESCRIBE],
      });
    }
  }

  if (entries.length === 0) return;

  try {
    const command = new BatchRevokePermissionsCommand({
      CatalogId: process.env.AWS_ACCOUNT_ID,
      Entries: entries,
    });

    await client.send(command);
  } catch (error) {
  }
}

export async function updateLakeFormationPermissions(
  iamRoleArn: string,
  oldPermissions: DataSourcePermission[],
  newPermissions: DataSourcePermission[]
): Promise<void> {
  await revokeLakeFormationPermissions(iamRoleArn, oldPermissions);
  await grantLakeFormationPermissions(iamRoleArn, newPermissions);
}
