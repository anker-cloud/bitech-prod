import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
} from "@aws-sdk/client-athena";

const client = new AthenaClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const outputLocation = process.env.ATHENA_OUTPUT_LOCATION || "s3://aws-athena-query-results/";
const isDemoMode = process.env.DEMO_MODE === "true" || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY;

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executionTimeMs: number;
}

async function waitForQueryCompletion(queryExecutionId: string): Promise<void> {
  const maxAttempts = 60;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const getExecutionCommand = new GetQueryExecutionCommand({
      QueryExecutionId: queryExecutionId,
    });

    const response = await client.send(getExecutionCommand);
    const state = response.QueryExecution?.Status?.State;

    if (state === QueryExecutionState.SUCCEEDED) {
      return;
    }

    if (state === QueryExecutionState.FAILED || state === QueryExecutionState.CANCELLED) {
      const reason = response.QueryExecution?.Status?.StateChangeReason || "Query failed";
      throw new Error(reason);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }

  throw new Error("Query timeout: exceeded maximum wait time");
}

export async function executeQuery(sql: string, databaseName: string): Promise<QueryResult> {
  const startTime = Date.now();

  if (isDemoMode) {
    console.log(`[Demo Mode] Would execute query on ${databaseName}: ${sql.substring(0, 100)}...`);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      columns: ["id", "name", "created_at", "status"],
      rows: [
        { id: "1", name: "Sample Record 1", created_at: "2024-01-15 10:30:00", status: "active" },
        { id: "2", name: "Sample Record 2", created_at: "2024-01-16 14:45:00", status: "pending" },
        { id: "3", name: "Sample Record 3", created_at: "2024-01-17 09:15:00", status: "active" },
        { id: "4", name: "Sample Record 4", created_at: "2024-01-18 16:20:00", status: "inactive" },
        { id: "5", name: "Sample Record 5", created_at: "2024-01-19 11:00:00", status: "active" },
      ],
      totalRows: 5,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const startCommand = new StartQueryExecutionCommand({
    QueryString: sql,
    QueryExecutionContext: {
      Database: databaseName,
    },
    ResultConfiguration: {
      OutputLocation: outputLocation,
    },
  });

  const startResponse = await client.send(startCommand);
  const queryExecutionId = startResponse.QueryExecutionId;

  if (!queryExecutionId) {
    throw new Error("Failed to start query execution");
  }

  await waitForQueryCompletion(queryExecutionId);

  const getResultsCommand = new GetQueryResultsCommand({
    QueryExecutionId: queryExecutionId,
  });

  const resultsResponse = await client.send(getResultsCommand);
  const resultSet = resultsResponse.ResultSet;

  if (!resultSet || !resultSet.Rows || resultSet.Rows.length === 0) {
    return {
      columns: [],
      rows: [],
      totalRows: 0,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const headerRow = resultSet.Rows[0];
  const columns = headerRow.Data?.map(cell => cell.VarCharValue || "") || [];

  const rows = resultSet.Rows.slice(1).map(row => {
    const rowData: Record<string, unknown> = {};
    row.Data?.forEach((cell, index) => {
      const columnName = columns[index];
      if (columnName) {
        rowData[columnName] = cell.VarCharValue;
      }
    });
    return rowData;
  });

  return {
    columns,
    rows,
    totalRows: rows.length,
    executionTimeMs: Date.now() - startTime,
  };
}

export async function validateQuery(sql: string, databaseName: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const startCommand = new StartQueryExecutionCommand({
      QueryString: `EXPLAIN ${sql}`,
      QueryExecutionContext: {
        Database: databaseName,
      },
      ResultConfiguration: {
        OutputLocation: outputLocation,
      },
    });

    const startResponse = await client.send(startCommand);
    const queryExecutionId = startResponse.QueryExecutionId;

    if (!queryExecutionId) {
      return { valid: false, error: "Failed to validate query" };
    }

    await waitForQueryCompletion(queryExecutionId);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid query",
    };
  }
}
