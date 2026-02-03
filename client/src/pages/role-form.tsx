import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Shield, ArrowLeft, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RowFilterBuilder } from "@/components/row-filter-builder";
import { DATA_SOURCES, type Role, type DataSourcePermission, type TablePermission, type RowFilterCondition } from "@shared/schema";

interface TableInfo {
  name: string;
  columns: { name: string; type: string }[];
}

interface DataSourceSchema {
  dataSourceId: string;
  tables: TableInfo[];
}

export default function RoleFormPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isEditing = !!id;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [permissions, setPermissions] = useState<DataSourcePermission[]>(
    DATA_SOURCES.map((ds) => ({
      dataSourceId: ds.id,
      hasAccess: false,
      tables: [],
    }))
  );

  const { data: existingRole, isLoading: isLoadingRole } = useQuery<Role>({
    queryKey: ["/api/roles", id],
    enabled: isEditing,
  });

  const { data: schemas, isLoading: isLoadingSchemas } = useQuery<DataSourceSchema[]>({
    queryKey: ["/api/data-sources/schemas"],
  });

  useEffect(() => {
    if (existingRole) {
      setName(existingRole.name);
      setDescription(existingRole.description || "");
      setIsAdmin(existingRole.isAdmin);
      if (existingRole.permissions) {
        setPermissions(
          DATA_SOURCES.map((ds) => {
            const existing = existingRole.permissions?.find((p) => p.dataSourceId === ds.id);
            return existing || { dataSourceId: ds.id, hasAccess: false, tables: [] };
          })
        );
      }
    }
  }, [existingRole]);

  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; isAdmin: boolean; permissions: DataSourcePermission[] }) => {
      if (isEditing) {
        return await apiRequest("PATCH", `/api/roles/${id}`, data);
      } else {
        return await apiRequest("POST", "/api/roles", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      toast({
        title: isEditing ? "Role updated" : "Role created",
        description: `The role has been successfully ${isEditing ? "updated" : "created"}.`,
      });
      navigate("/roles");
    },
    onError: (error: Error) => {
      toast({
        title: `Failed to ${isEditing ? "update" : "create"} role`,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDataSourceToggle = (dataSourceId: string, hasAccess: boolean) => {
    setPermissions((prev) =>
      prev.map((p) =>
        p.dataSourceId === dataSourceId
          ? { ...p, hasAccess, tables: hasAccess ? p.tables : [] }
          : p
      )
    );
  };

  const handleTableToggle = (dataSourceId: string, tableName: string, hasAccess: boolean, allColumns: { name: string }[]) => {
    setPermissions((prev) =>
      prev.map((p) => {
        if (p.dataSourceId !== dataSourceId) return p;
        const existingTable = p.tables.find((t) => t.tableName === tableName);
        if (hasAccess) {
          if (existingTable) return p;
          return {
            ...p,
            tables: [...p.tables, { tableName, columns: [], allColumns: true, allRows: true, rowFilters: [] }],
          };
        } else {
          return {
            ...p,
            tables: p.tables.filter((t) => t.tableName !== tableName),
          };
        }
      })
    );
  };

  const handleColumnToggle = (dataSourceId: string, tableName: string, columnName: string, selected: boolean, totalColumns: number) => {
    setPermissions((prev) =>
      prev.map((p) => {
        if (p.dataSourceId !== dataSourceId) return p;
        return {
          ...p,
          tables: p.tables.map((t) => {
            if (t.tableName !== tableName) return t;
            let newColumns: string[];
            if (selected) {
              newColumns = [...t.columns, columnName];
            } else {
              newColumns = t.columns.filter((c) => c !== columnName);
            }
            return {
              ...t,
              columns: newColumns,
              allColumns: newColumns.length === totalColumns,
            };
          }),
        };
      })
    );
  };

  const handleAllColumnsToggle = (dataSourceId: string, tableName: string, allColumns: boolean, columns: { name: string }[]) => {
    setPermissions((prev) =>
      prev.map((p) => {
        if (p.dataSourceId !== dataSourceId) return p;
        return {
          ...p,
          tables: p.tables.map((t) => {
            if (t.tableName !== tableName) return t;
            return {
              ...t,
              allColumns,
              columns: allColumns ? [] : columns.map((c) => c.name),
            };
          }),
        };
      })
    );
  };

  const handleAllRowsToggle = (dataSourceId: string, tableName: string, allRows: boolean) => {
    setPermissions((prev) =>
      prev.map((p) => {
        if (p.dataSourceId !== dataSourceId) return p;
        return {
          ...p,
          tables: p.tables.map((t) => {
            if (t.tableName !== tableName) return t;
            return {
              ...t,
              allRows,
              rowFilters: allRows ? [] : t.rowFilters || [],
            };
          }),
        };
      })
    );
  };

  const handleRowFiltersChange = (dataSourceId: string, tableName: string, rowFilters: RowFilterCondition[]) => {
    setPermissions((prev) =>
      prev.map((p) => {
        if (p.dataSourceId !== dataSourceId) return p;
        return {
          ...p,
          tables: p.tables.map((t) => {
            if (t.tableName !== tableName) return t;
            return {
              ...t,
              rowFilters,
            };
          }),
        };
      })
    );
  };

  const getTablePermission = (dataSourceId: string, tableName: string): TablePermission | undefined => {
    return permissions.find((p) => p.dataSourceId === dataSourceId)?.tables.find((t) => t.tableName === tableName);
  };

  const isColumnSelected = (dataSourceId: string, tableName: string, columnName: string): boolean => {
    const tablePermission = getTablePermission(dataSourceId, tableName);
    if (!tablePermission) return false;
    if (tablePermission.allColumns) return true;
    return tablePermission.columns.includes(columnName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: "Validation error",
        description: "Role name is required",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate({ name: name.trim(), description: description.trim(), isAdmin, permissions });
  };

  if (isEditing && isLoadingRole) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={() => navigate("/roles")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{isEditing ? "Edit Role" : "Create Role"}</h1>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <form onSubmit={handleSubmit} className="p-4 space-y-6 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>Role Details</CardTitle>
              <CardDescription>Basic information about this role</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Role Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Risk Analyst"
                  data-testid="input-role-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this role is for..."
                  data-testid="input-role-description"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="admin-toggle">Administrator Access</Label>
                  <p className="text-sm text-muted-foreground">
                    Admins can manage roles and users
                  </p>
                </div>
                <Switch
                  id="admin-toggle"
                  checked={isAdmin}
                  onCheckedChange={setIsAdmin}
                  data-testid="switch-is-admin"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data Source Permissions</CardTitle>
              <CardDescription>
                Configure which data sources, tables, and columns this role can access
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingSchemas ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <Accordion type="multiple" className="space-y-2">
                  {DATA_SOURCES.map((ds) => {
                    const permission = permissions.find((p) => p.dataSourceId === ds.id);
                    const schema = schemas?.find((s) => s.dataSourceId === ds.id);
                    
                    return (
                      <AccordionItem key={ds.id} value={ds.id} className="border rounded-md px-4">
                        <div className="flex items-center gap-4 py-4">
                          <Switch
                            checked={permission?.hasAccess || false}
                            onCheckedChange={(checked) => handleDataSourceToggle(ds.id, checked)}
                            data-testid={`switch-ds-${ds.id}`}
                          />
                          <AccordionTrigger className="flex-1 hover:no-underline py-0">
                            <div className="flex items-center gap-3">
                              <div>
                                <span className="font-medium">{ds.name}</span>
                                <p className="text-sm text-muted-foreground text-left">
                                  {ds.description}
                                </p>
                              </div>
                            </div>
                          </AccordionTrigger>
                          {permission?.hasAccess && (
                            <Badge variant="secondary" className="ml-auto mr-2">
                              {permission.tables.length} tables
                            </Badge>
                          )}
                        </div>
                        <AccordionContent className="pb-4">
                          {permission?.hasAccess && schema?.tables ? (
                            <div className="space-y-4 pl-12">
                              {schema.tables.map((table) => {
                                const tablePermission = getTablePermission(ds.id, table.name);
                                const isTableSelected = !!tablePermission;
                                
                                return (
                                  <div key={table.name} className="border rounded-md p-4">
                                    <div className="flex items-center gap-3 mb-3">
                                      <Checkbox
                                        checked={isTableSelected}
                                        onCheckedChange={(checked) => 
                                          handleTableToggle(ds.id, table.name, checked as boolean, table.columns)
                                        }
                                        data-testid={`checkbox-table-${ds.id}-${table.name}`}
                                      />
                                      <span className="font-medium">{table.name}</span>
                                      {isTableSelected && (
                                        <div className="flex items-center gap-2 ml-auto">
                                          <Label className="text-sm">All columns</Label>
                                          <Switch
                                            checked={tablePermission?.allColumns || false}
                                            onCheckedChange={(checked) =>
                                              handleAllColumnsToggle(ds.id, table.name, checked, table.columns)
                                            }
                                            data-testid={`switch-all-columns-${ds.id}-${table.name}`}
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {isTableSelected && !tablePermission?.allColumns && (
                                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pl-6 mb-4">
                                        {table.columns.map((column) => (
                                          <div key={column.name} className="flex items-center gap-2">
                                            <Checkbox
                                              checked={isColumnSelected(ds.id, table.name, column.name)}
                                              onCheckedChange={(checked) =>
                                                handleColumnToggle(ds.id, table.name, column.name, checked as boolean, table.columns.length)
                                              }
                                              data-testid={`checkbox-column-${ds.id}-${table.name}-${column.name}`}
                                            />
                                            <span className="text-sm">{column.name}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    
                                    {isTableSelected && (
                                      <div className="border-t pt-4 mt-4 pl-6">
                                        <Label className="text-sm font-medium mb-3 block">Row Access</Label>
                                        <RadioGroup
                                          value={tablePermission?.allRows !== false ? "all" : "filtered"}
                                          onValueChange={(value) => handleAllRowsToggle(ds.id, table.name, value === "all")}
                                          className="flex gap-6 mb-3"
                                        >
                                          <div className="flex items-center gap-2">
                                            <RadioGroupItem value="all" id={`all-rows-${ds.id}-${table.name}`} data-testid={`radio-all-rows-${ds.id}-${table.name}`} />
                                            <Label htmlFor={`all-rows-${ds.id}-${table.name}`} className="text-sm font-normal cursor-pointer">All Rows</Label>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <RadioGroupItem value="filtered" id={`filtered-rows-${ds.id}-${table.name}`} data-testid={`radio-filtered-rows-${ds.id}-${table.name}`} />
                                            <Label htmlFor={`filtered-rows-${ds.id}-${table.name}`} className="text-sm font-normal cursor-pointer">Filtered Rows</Label>
                                          </div>
                                        </RadioGroup>
                                        
                                        {tablePermission?.allRows === false && (
                                          <div className="bg-muted/50 rounded-md p-4">
                                            <RowFilterBuilder
                                              columns={table.columns}
                                              filters={tablePermission.rowFilters || []}
                                              onChange={(filters) => handleRowFiltersChange(ds.id, table.name, filters)}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground pl-12">
                              Enable access to configure table and column permissions
                            </p>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-4">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              data-testid="button-save-role"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isEditing ? "Updating..." : "Creating..."}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {isEditing ? "Update Role" : "Create Role"}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/roles")}
              data-testid="button-cancel"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        </form>
      </ScrollArea>
    </div>
  );
}
