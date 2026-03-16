import {
  GlueClient,
  GetTablesCommand,
  GetTableCommand,
} from "@aws-sdk/client-glue";
import { DATA_SOURCES } from "@shared/schema";
import { getActiveDatabase } from "./config";

const client = new GlueClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export interface TableColumn {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  columns: TableColumn[];
}

export interface DataSourceSchema {
  dataSourceId: string;
  tables: TableInfo[];
}

export async function getDataSourceSchemas(): Promise<DataSourceSchema[]> {
  const schemas: DataSourceSchema[] = [];
  const activeDb = getActiveDatabase();

  for (const dataSource of DATA_SOURCES) {
    try {
      const command = new GetTableCommand({
        DatabaseName: activeDb,
        Name: dataSource.tableName,
      });

      const response = await client.send(command);
      const columns: TableColumn[] = (response.Table?.StorageDescriptor?.Columns || []).map(col => ({
        name: col.Name || "",
        type: col.Type || "string",
      }));

      schemas.push({
        dataSourceId: dataSource.id,
        tables: [{ name: dataSource.tableName, columns }],
      });
    } catch (error) {
      console.error(`Error fetching schema for ${dataSource.id} (${dataSource.tableName}) from ${activeDb}:`, error);
      schemas.push({
        dataSourceId: dataSource.id,
        tables: [],
      });
    }
  }

  return schemas;
}

export async function getTableColumns(databaseName: string, tableName: string): Promise<TableColumn[]> {
  try {
    const command = new GetTableCommand({
      DatabaseName: databaseName,
      Name: tableName,
    });

    const response = await client.send(command);

    return (response.Table?.StorageDescriptor?.Columns || []).map(col => ({
      name: col.Name || "",
      type: col.Type || "string",
    }));
  } catch (error) {
    return [
      { name: "id", type: "string" },
      { name: "created_at", type: "timestamp" },
      { name: "data", type: "string" },
    ];
  }
}

export async function getDataSourceColumns(dataSourceId: string): Promise<TableColumn[]> {
  const schemas = await getDataSourceSchemas();
  const schema = schemas.find(s => s.dataSourceId === dataSourceId);

  if (!schema || schema.tables.length === 0) {
    return [];
  }

  return schema.tables[0].columns;
}
