import { useState, useMemo, useEffect } from "react";
import { useQueries, useMutation } from "@tanstack/react-query";
import { Database, Play, Download, Code, Wand2, Plus, X, Loader2, ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { DATA_SOURCES, filterOperators, type DataSourceId, type QueryFilter, type QueryConfig } from "@shared/schema";
import { normalizeGermanExpr, normalizeGermanValue } from "@shared/sql-normalize";
import { apiRequest } from "@/lib/queryClient";

interface TableColumn {
  name: string;
  type: string;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  executionTimeMs: number;
}

export default function DataViewerPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [queryMode, setQueryMode] = useState<"builder" | "custom">("builder");
  const [selectedDataSources, setSelectedDataSources] = useState<DataSourceId[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<QueryFilter[]>([]);
  const [customSql, setCustomSql] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const rowsPerPage = 50;

  const accessibleDataSources = useMemo(() => {
    if (!user?.role?.permissions) return [];
    if (user.role.isAdmin) return [...DATA_SOURCES];
    return DATA_SOURCES.filter((ds) => {
      const permission = user.role?.permissions.find((p) => p.dataSourceId === ds.id);
      return permission?.hasAccess;
    });
  }, [user]);

  const isMultiTable = selectedDataSources.length > 1;

  const columnQueries = useQueries({
    queries: selectedDataSources.map((dsId) => ({
      queryKey: ['/api/data-sources', dsId, 'columns'],
      queryFn: async () => {
        const res = await fetch(`/api/data-sources/${dsId}/columns`, {
          headers: { Authorization: `Bearer ${user?.accessToken}` },
        });
        if (!res.ok) throw new Error("Failed to fetch columns");
        return res.json() as Promise<TableColumn[]>;
      },
      enabled: !!dsId,
    })),
  });

  const isLoadingColumns = columnQueries.some((q) => q.isLoading);

  const columnQueryData = columnQueries.map(q => q.data);
  const allColumnsPerSource = useMemo(() => {
    const result: Record<string, TableColumn[]> = {};
    selectedDataSources.forEach((dsId, i) => {
      const data = columnQueryData[i];
      if (data) {
        const permission = user?.role?.permissions?.find((p) => p.dataSourceId === dsId);
        const tablePermission = permission?.tables?.[0];
        if (tablePermission && !tablePermission.allColumns && tablePermission.columns.length > 0) {
          result[dsId] = data.filter((col: TableColumn) => tablePermission.columns.includes(col.name));
        } else {
          result[dsId] = data;
        }
      }
    });
    return result;
  }, [selectedDataSources, columnQueryData, user]);

  const accessibleColumns = useMemo(() => {
    const sources = selectedDataSources;
    if (sources.length === 0) return [];

    if (sources.length === 1) {
      return allColumnsPerSource[sources[0]] || [];
    }

    const columnSets = sources.map((dsId) => {
      const cols = allColumnsPerSource[dsId] || [];
      return new Set(cols.map((c) => c.name));
    });

    if (columnSets.length === 0) return [];
    const commonNames = [...columnSets[0]].filter((name) =>
      columnSets.every((set) => set.has(name))
    );

    const firstSourceCols = allColumnsPerSource[sources[0]] || [];
    return firstSourceCols.filter((col) => commonNames.includes(col.name));
  }, [selectedDataSources, allColumnsPerSource]);

  const joinColumns = useMemo(() => {
    if (!isMultiTable) return [];
    return accessibleColumns.map((c) => c.name);
  }, [isMultiTable, accessibleColumns]);

  useEffect(() => {
    setSelectedColumns([]);
    setFilters([]);
  }, [selectedDataSources.join(",")]);

  const generatedSql = useMemo(() => {
    if (selectedDataSources.length === 0 || selectedColumns.length === 0) return "";

    if (!isMultiTable) {
      const dsId = selectedDataSources[0];
      const dataSource = DATA_SOURCES.find((ds) => ds.id === dsId);
      const tableName = dataSource?.tableName || dsId;
      const cols = selectedColumns.join(", ");
      let sql = `SELECT ${cols}\nFROM ${tableName}`;

      if (filters.length > 0) {
        const whereClause = filters
          .map((f, i) => {
            let condition = "";
            const isStringOp = ["equals", "not_equals", "contains", "not_contains", "in"].includes(f.operator);
            const quotedCol = `"${f.column}"`;
            const col = isStringOp ? normalizeGermanExpr(quotedCol) : quotedCol;
            const val = isStringOp ? normalizeGermanValue(f.value) : f.value;
            switch (f.operator) {
              case "equals":
                condition = `${col} = '${val}'`;
                break;
              case "not_equals":
                condition = `${col} != '${val}'`;
                break;
              case "contains":
                condition = `${col} LIKE '%${val}%'`;
                break;
              case "not_contains":
                condition = `${col} NOT LIKE '%${val}%'`;
                break;
              case "greater_than":
                condition = `${quotedCol} > '${f.value}'`;
                break;
              case "less_than":
                condition = `${quotedCol} < '${f.value}'`;
                break;
              case "greater_or_equal":
                condition = `${quotedCol} >= '${f.value}'`;
                break;
              case "less_or_equal":
                condition = `${quotedCol} <= '${f.value}'`;
                break;
            }
            return i === 0 ? condition : `${f.logic || "AND"} ${condition}`;
          })
          .join("\n  ");
        sql += `\nWHERE ${whereClause}`;
      }

      return sql;
    }

    const sources = selectedDataSources.map((dsId, i) => {
      const ds = DATA_SOURCES.find((d) => d.id === dsId);
      return { dsId, tableName: ds?.tableName || dsId, alias: `t${i + 1}` };
    });

    const cols = selectedColumns.map((col) => `t1."${col}"`).join(", ");

    let sql = `SELECT ${cols}\nFROM ${sources[0].tableName} ${sources[0].alias}`;

    for (let i = 1; i < sources.length; i++) {
      const joinConditions = joinColumns
        .map((jc) => `${sources[0].alias}."${jc}" = ${sources[i].alias}."${jc}"`)
        .join(" AND ");
      sql += `\nINNER JOIN ${sources[i].tableName} ${sources[i].alias} ON ${joinConditions}`;
    }

    if (filters.length > 0) {
      const whereClause = filters
        .map((f, i) => {
          let condition = "";
          const isStringOp = ["equals", "not_equals", "contains", "not_contains", "in"].includes(f.operator);
          const aliasedCol = `t1."${f.column}"`;
          const col = isStringOp ? normalizeGermanExpr(aliasedCol) : aliasedCol;
          const val = isStringOp ? normalizeGermanValue(f.value) : f.value;
          switch (f.operator) {
            case "equals":
              condition = `${col} = '${val}'`;
              break;
            case "not_equals":
              condition = `${col} != '${val}'`;
              break;
            case "contains":
              condition = `${col} LIKE '%${val}%'`;
              break;
            case "not_contains":
              condition = `${col} NOT LIKE '%${val}%'`;
              break;
            case "greater_than":
              condition = `${aliasedCol} > '${f.value}'`;
              break;
            case "less_than":
              condition = `${aliasedCol} < '${f.value}'`;
              break;
            case "greater_or_equal":
              condition = `${aliasedCol} >= '${f.value}'`;
              break;
            case "less_or_equal":
              condition = `${aliasedCol} <= '${f.value}'`;
              break;
          }
          return i === 0 ? condition : `${f.logic || "AND"} ${condition}`;
        })
        .join("\n  ");
      sql += `\nWHERE ${whereClause}`;
    }

    return sql;
  }, [selectedDataSources, selectedColumns, filters, isMultiTable, joinColumns]);

  const queryMutation = useMutation({
    mutationFn: async (config: { sql: string; dataSourceIds: string[] }): Promise<QueryResult> => {
      const response = await apiRequest("POST", "/api/query/execute", config);
      return response.json();
    },
    onError: (error: Error) => {
      toast({
        title: "Query failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRunQuery = () => {
    const sql = queryMode === "custom" ? customSql : generatedSql;
    if (!sql.trim()) {
      toast({
        title: "No query to run",
        description: "Please build a query or enter custom SQL",
        variant: "destructive",
      });
      return;
    }
    if (selectedDataSources.length === 0) {
      toast({
        title: "No data source selected",
        description: "Please select at least one data source",
        variant: "destructive",
      });
      return;
    }
    queryMutation.mutate({ sql, dataSourceIds: selectedDataSources });
  };

  const handleExportCsv = () => {
    if (!queryMutation.data) return;

    const { columns, rows } = queryMutation.data;
    const csvContent = [
      columns.join(","),
      ...rows.map((row) => columns.map((col) => `"${row[col] ?? ""}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-results-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addFilter = () => {
    const filterColumns = isMultiTable ? accessibleColumns.filter(c => joinColumns.includes(c.name)) : accessibleColumns;
    if (filterColumns.length === 0) return;
    setFilters([
      ...filters,
      {
        column: filterColumns[0].name,
        operator: "equals",
        value: "",
        logic: filters.length > 0 ? "AND" : undefined,
      },
    ]);
  };

  const removeFilter = (index: number) => {
    const newFilters = filters.filter((_, i) => i !== index);
    if (newFilters.length > 0 && newFilters[0].logic) {
      newFilters[0].logic = undefined;
    }
    setFilters(newFilters);
  };

  const updateFilter = (index: number, updates: Partial<QueryFilter>) => {
    setFilters(filters.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  const handleColumnToggle = (columnName: string, checked: boolean) => {
    if (checked) {
      setSelectedColumns([...selectedColumns, columnName]);
    } else {
      setSelectedColumns(selectedColumns.filter((c) => c !== columnName));
    }
  };

  const handleDataSourceToggle = (dsId: DataSourceId, checked: boolean) => {
    if (checked) {
      setSelectedDataSources([...selectedDataSources, dsId]);
    } else {
      setSelectedDataSources(selectedDataSources.filter((id) => id !== dsId));
    }
  };

  const selectAllColumns = () => {
    setSelectedColumns(accessibleColumns.map((c) => c.name));
  };

  const clearAllColumns = () => {
    setSelectedColumns([]);
  };

  const sortedResults = useMemo(() => {
    if (!queryMutation.data?.rows || !sortColumn) return queryMutation.data?.rows || [];
    return [...queryMutation.data.rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [queryMutation.data, sortColumn, sortDirection]);

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sortedResults.slice(start, start + rowsPerPage);
  }, [sortedResults, currentPage]);

  const totalPages = Math.ceil((sortedResults.length || 0) / rowsPerPage);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const filterableColumns = useMemo(() => {
    if (isMultiTable) {
      return accessibleColumns.filter((c) => joinColumns.includes(c.name));
    }
    return accessibleColumns;
  }, [isMultiTable, accessibleColumns, joinColumns]);

  if (accessibleDataSources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <Database className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2" data-testid="text-no-data-sources">No Data Sources Available</h2>
        <p className="text-muted-foreground text-center max-w-md">
          You don't have access to any data sources. Please contact your administrator to request access.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${isExpanded ? "fixed inset-0 z-50 bg-background" : ""}`}>
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Data Viewer</h1>
        </div>
        <div className="flex items-center gap-2">
          {queryMutation.data && (
            <Button variant="outline" size="sm" onClick={handleExportCsv} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid="button-toggle-expand"
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 border-r flex flex-col">
          <div className="p-4 space-y-4 overflow-auto flex-1">
            <div className="space-y-2">
              <Label>Data Sources</Label>
              <ScrollArea className="h-32 rounded-md border p-2">
                <div className="space-y-2">
                  {accessibleDataSources.map((ds) => (
                    <div key={ds.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`ds-${ds.id}`}
                        checked={selectedDataSources.includes(ds.id)}
                        onCheckedChange={(checked) => handleDataSourceToggle(ds.id, checked as boolean)}
                        data-testid={`checkbox-datasource-${ds.id}`}
                      />
                      <label htmlFor={`ds-${ds.id}`} className="text-sm flex-1 cursor-pointer">
                        {ds.name}
                      </label>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              {isMultiTable && (
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="secondary" className="text-xs" data-testid="badge-join-mode">
                    JOIN Mode
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {joinColumns.length} common column{joinColumns.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>

            <Tabs value={queryMode} onValueChange={(v) => setQueryMode(v as "builder" | "custom")}>
              <TabsList className="w-full">
                <TabsTrigger value="builder" className="flex-1" data-testid="tab-query-builder">
                  <Wand2 className="h-4 w-4 mr-2" />
                  Builder
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex-1" data-testid="tab-custom-query">
                  <Code className="h-4 w-4 mr-2" />
                  Custom
                </TabsTrigger>
              </TabsList>

              <TabsContent value="builder" className="space-y-4 mt-4">
                {selectedDataSources.length > 0 && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{isMultiTable ? "Common Columns" : "Columns"}</Label>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={selectAllColumns} className="h-6 text-xs">
                            All
                          </Button>
                          <Button variant="ghost" size="sm" onClick={clearAllColumns} className="h-6 text-xs">
                            None
                          </Button>
                        </div>
                      </div>
                      {isLoadingColumns ? (
                        <div className="space-y-2">
                          {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-6 w-full" />
                          ))}
                        </div>
                      ) : accessibleColumns.length === 0 && isMultiTable ? (
                        <p className="text-xs text-muted-foreground text-center py-2" data-testid="text-no-common-columns">
                          No common columns found between the selected tables
                        </p>
                      ) : (
                        <ScrollArea className="h-48 rounded-md border p-2">
                          <div className="space-y-2">
                            {accessibleColumns.map((column) => (
                              <div key={column.name} className="flex items-center gap-2">
                                <Checkbox
                                  id={column.name}
                                  checked={selectedColumns.includes(column.name)}
                                  onCheckedChange={(checked) => handleColumnToggle(column.name, checked as boolean)}
                                  data-testid={`checkbox-column-${column.name}`}
                                />
                                <label htmlFor={column.name} className="text-sm flex-1 cursor-pointer">
                                  {column.name}
                                </label>
                                <Badge variant="outline" className="text-xs">
                                  {column.type}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Filters {isMultiTable && <span className="text-xs text-muted-foreground">(join columns only)</span>}</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={addFilter}
                          disabled={filterableColumns.length === 0}
                          className="h-6"
                          data-testid="button-add-filter"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {filters.map((filter, index) => (
                          <Card key={index} className="p-2">
                            <div className="space-y-2">
                              {index > 0 && (
                                <Select
                                  value={filter.logic}
                                  onValueChange={(value: "AND" | "OR") => updateFilter(index, { logic: value })}
                                >
                                  <SelectTrigger className="h-7 w-20">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="AND">AND</SelectItem>
                                    <SelectItem value="OR">OR</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                              <div className="flex gap-1">
                                <Select
                                  value={filter.column}
                                  onValueChange={(value) => updateFilter(index, { column: value })}
                                >
                                  <SelectTrigger className="h-8 flex-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {filterableColumns.map((col) => (
                                      <SelectItem key={col.name} value={col.name}>
                                        {col.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removeFilter(index)}
                                  data-testid={`button-remove-filter-${index}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                              <Select
                                value={filter.operator}
                                onValueChange={(value) => updateFilter(index, { operator: value as QueryFilter["operator"] })}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {filterOperators.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                placeholder="Value"
                                value={filter.value}
                                onChange={(e) => updateFilter(index, { value: e.target.value })}
                                className="h-8"
                                data-testid={`input-filter-value-${index}`}
                              />
                            </div>
                          </Card>
                        ))}
                        {filters.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            No filters added
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="custom" className="mt-4">
                <div className="space-y-2">
                  <Label>SQL Query</Label>
                  <Textarea
                    placeholder="Enter your SQL query here..."
                    className="font-mono text-sm min-h-[200px]"
                    value={customSql}
                    onChange={(e) => setCustomSql(e.target.value)}
                    data-testid="textarea-custom-sql"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="p-4 border-t space-y-3">
            {queryMode === "builder" && generatedSql && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Generated SQL</Label>
                <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto font-mono" data-testid="text-generated-sql">
                  {generatedSql}
                </pre>
              </div>
            )}
            <Button
              className="w-full"
              onClick={handleRunQuery}
              disabled={queryMutation.isPending || (!generatedSql && queryMode === "builder") || (!customSql && queryMode === "custom") || selectedDataSources.length === 0}
              data-testid="button-run-query"
            >
              {queryMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Query
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {queryMutation.isPending ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-muted-foreground">Executing query...</p>
              </div>
            </div>
          ) : queryMutation.data ? (
            <>
              <div className="p-4 border-b flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-4">
                  <Badge variant="secondary" data-testid="badge-row-count">{queryMutation.data.totalRows} rows</Badge>
                  <span className="text-sm text-muted-foreground">
                    Executed in {queryMutation.data.executionTimeMs}ms
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {queryMutation.data.columns.map((column) => (
                        <TableHead
                          key={column}
                          className="cursor-pointer hover-elevate"
                          onClick={() => handleSort(column)}
                        >
                          <div className="flex items-center gap-1">
                            {column}
                            {sortColumn === column && (
                              sortDirection === "asc" ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )
                            )}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedResults.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {queryMutation.data!.columns.map((column) => (
                          <TableCell key={column} className="font-mono text-sm">
                            {row[column] !== null && row[column] !== undefined
                              ? String(row[column])
                              : <span className="text-muted-foreground italic">null</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4 text-center p-8">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <Database className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold">No Results Yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select a data source, choose columns, and run a query to see results
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
