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
  rows: (string | null)[][];
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

  let columns: string[] = [];
  const rows: (string | null)[][] = [];
  let nextToken: string | undefined = undefined;
  let isFirstPage = true;

  do {
    const getResultsCommand = new GetQueryResultsCommand({
      QueryExecutionId: queryExecutionId,
      NextToken: nextToken,
    });

    const resultsResponse = await client.send(getResultsCommand);
    const resultSet = resultsResponse.ResultSet;

    if (!resultSet || !resultSet.Rows || resultSet.Rows.length === 0) {
      break;
    }

    if (isFirstPage) {
      const headerRow = resultSet.Rows[0];
      columns = headerRow.Data?.map(cell => cell.VarCharValue || "") ?? [];
      isFirstPage = false;
      for (const row of resultSet.Rows.slice(1)) {
        rows.push(columns.map((_, index) => {
          const cell = row.Data?.[index];
          return cell?.VarCharValue !== undefined ? cell.VarCharValue : null;
        }));
      }
    } else {
      for (const row of resultSet.Rows) {
        rows.push(columns.map((_, index) => {
          const cell = row.Data?.[index];
          return cell?.VarCharValue !== undefined ? cell.VarCharValue : null;
        }));
      }
    }

    nextToken = resultsResponse.NextToken;
  } while (nextToken !== undefined);

  if (columns.length === 0) {
    return { columns: [], rows: [], totalRows: 0, executionTimeMs: Date.now() - startTime };
  }

  return {
    columns,
    rows,
    totalRows: rows.length,
    executionTimeMs: Date.now() - startTime,
  };
}

export type StreamChunk =
  | { type: 'columns'; columns: string[] }
  | { type: 'rows'; rows: (string | null)[][]; pageIndex: number; cumulativeRows: number }
  | { type: 'complete'; totalRows: number; executionTimeMs: number }
  | { type: 'error'; message: string }

export async function* executeQueryStream(
  sql: string,
  databaseName: string,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const startTime = Date.now();

  try {
    const startCommand = new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: databaseName },
      ResultConfiguration: { OutputLocation: outputLocation },
    });

    const startResponse = await client.send(startCommand);
    const queryExecutionId = startResponse.QueryExecutionId;

    if (!queryExecutionId) {
      yield { type: 'error', message: 'Failed to start query execution' };
      return;
    }

    await waitForQueryCompletion(queryExecutionId);

    let columns: string[] = [];
    let nextToken: string | undefined = undefined;
    let isFirstPage = true;
    let pageIndex = 0;
    let cumulativeRows = 0;

    do {
      if (signal?.aborted) break;

      const getResultsCommand = new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
      });

      const resultsResponse = await client.send(getResultsCommand);
      const resultSet = resultsResponse.ResultSet;

      if (!resultSet || !resultSet.Rows || resultSet.Rows.length === 0) break;

      let pageRows: (string | null)[][];

      if (isFirstPage) {
        const headerRow = resultSet.Rows[0];
        columns = headerRow.Data?.map(cell => cell.VarCharValue || '') ?? [];
        yield { type: 'columns', columns };
        isFirstPage = false;
        pageRows = resultSet.Rows.slice(1).map(row =>
          columns.map((_, index) => {
            const cell = row.Data?.[index];
            return cell?.VarCharValue !== undefined ? cell.VarCharValue : null;
          })
        );
      } else {
        pageRows = resultSet.Rows.map(row =>
          columns.map((_, index) => {
            const cell = row.Data?.[index];
            return cell?.VarCharValue !== undefined ? cell.VarCharValue : null;
          })
        );
      }

      cumulativeRows += pageRows.length;
      yield { type: 'rows', rows: pageRows, pageIndex, cumulativeRows };
      pageIndex++;
      nextToken = resultsResponse.NextToken;
    } while (nextToken !== undefined);

    yield { type: 'complete', totalRows: cumulativeRows, executionTimeMs: Date.now() - startTime };
  } catch (error) {
    yield { type: 'error', message: error instanceof Error ? error.message : 'Query execution failed' };
  }
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
