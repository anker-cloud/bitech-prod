import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
} from "@aws-sdk/client-athena";

const client = new AthenaClient({
  region: process.env.AWS_REGION || "eu-central-1",
});

const outputLocation = process.env.ATHENA_OUTPUT_LOCATION || "s3://aws-athena-query-results/";

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
        rowData[columnName] = cell.VarCharValue !== undefined ? cell.VarCharValue : null;
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
