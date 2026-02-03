import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Database, Play, Download, Code, Wand2, Plus, X, Loader2, ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [selectedDataSource, setSelectedDataSource] = useState<DataSourceId | "">("");
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
    return DATA_SOURCES.filter((ds) => {
      const permission = user.role?.permissions.find((p) => p.dataSourceId === ds.id);
      return permission?.hasAccess;
    });
  }, [user]);

  const { data: tableColumns, isLoading: isLoadingColumns } = useQuery<TableColumn[]>({
    queryKey: ["/api/data-sources", selectedDataSource, "columns"],
    enabled: !!selectedDataSource,
  });

  const accessibleColumns = useMemo(() => {
    if (!tableColumns || !user?.role?.permissions || !selectedDataSource) return [];
    const permission = user.role.permissions.find((p) => p.dataSourceId === selectedDataSource);
    if (!permission) return [];
    const tablePermission = permission.tables[0];
    if (!tablePermission) return tableColumns;
    if (tablePermission.allColumns) return tableColumns;
    return tableColumns.filter((col) => tablePermission.columns.includes(col.name));
  }, [tableColumns, user, selectedDataSource]);

  const generatedSql = useMemo(() => {
    if (!selectedDataSource || selectedColumns.length === 0) return "";
    
    const cols = selectedColumns.join(", ");
    let sql = `SELECT ${cols}\nFROM ${selectedDataSource.replace("-data-db", "")}`;
    
    if (filters.length > 0) {
      const whereClause = filters
        .map((f, i) => {
          let condition = "";
          switch (f.operator) {
            case "equals":
              condition = `${f.column} = '${f.value}'`;
              break;
            case "not_equals":
              condition = `${f.column} != '${f.value}'`;
              break;
            case "contains":
              condition = `${f.column} LIKE '%${f.value}%'`;
              break;
            case "not_contains":
              condition = `${f.column} NOT LIKE '%${f.value}%'`;
              break;
            case "greater_than":
              condition = `${f.column} > '${f.value}'`;
              break;
            case "less_than":
              condition = `${f.column} < '${f.value}'`;
              break;
            case "greater_or_equal":
              condition = `${f.column} >= '${f.value}'`;
              break;
            case "less_or_equal":
              condition = `${f.column} <= '${f.value}'`;
              break;
          }
          return i === 0 ? condition : `${f.logic || "AND"} ${condition}`;
        })
        .join("\n  ");
      sql += `\nWHERE ${whereClause}`;
    }
    
    return sql;
  }, [selectedDataSource, selectedColumns, filters]);

  const queryMutation = useMutation({
    mutationFn: async (config: { sql: string; dataSourceId: string }): Promise<QueryResult> => {
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
    if (!selectedDataSource) {
      toast({
        title: "No data source selected",
        description: "Please select a data source first",
        variant: "destructive",
      });
      return;
    }
    queryMutation.mutate({ sql, dataSourceId: selectedDataSource });
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
    if (accessibleColumns.length === 0) return;
    setFilters([
      ...filters,
      {
        column: accessibleColumns[0].name,
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

  if (accessibleDataSources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <Database className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Data Sources Available</h2>
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
              <Label>Data Source</Label>
              <Select
                value={selectedDataSource}
                onValueChange={(value: DataSourceId) => {
                  setSelectedDataSource(value);
                  setSelectedColumns([]);
                  setFilters([]);
                }}
              >
                <SelectTrigger data-testid="select-data-source">
                  <SelectValue placeholder="Select a data source" />
                </SelectTrigger>
                <SelectContent>
                  {accessibleDataSources.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {selectedDataSource && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Columns</Label>
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
                        <Label>Filters</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={addFilter}
                          disabled={accessibleColumns.length === 0}
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
                                    {accessibleColumns.map((col) => (
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
                <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto font-mono">
                  {generatedSql}
                </pre>
              </div>
            )}
            <Button
              className="w-full"
              onClick={handleRunQuery}
              disabled={queryMutation.isPending || (!generatedSql && queryMode === "builder") || (!customSql && queryMode === "custom")}
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
                  <Badge variant="secondary">{queryMutation.data.totalRows} rows</Badge>
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
