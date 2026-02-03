import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RowFilterCondition } from "@shared/schema";

interface RowFilterBuilderProps {
  columns: { name: string; type: string }[];
  filters: RowFilterCondition[];
  onChange: (filters: RowFilterCondition[]) => void;
}

const OPERATORS = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "!=" },
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "contains", label: "LIKE" },
  { value: "in", label: "IN" },
] as const;

export function RowFilterBuilder({ columns, filters, onChange }: RowFilterBuilderProps) {
  const addFilter = () => {
    const newFilter: RowFilterCondition = {
      column: columns[0]?.name || "",
      operator: "equals",
      value: "",
      logic: filters.length > 0 ? "AND" : undefined,
    };
    onChange([...filters, newFilter]);
  };

  const updateFilter = (index: number, updates: Partial<RowFilterCondition>) => {
    const newFilters = filters.map((f, i) => (i === index ? { ...f, ...updates } : f));
    onChange(newFilters);
  };

  const removeFilter = (index: number) => {
    const newFilters = filters.filter((_, i) => i !== index);
    if (newFilters.length > 0 && newFilters[0].logic) {
      newFilters[0] = { ...newFilters[0], logic: undefined };
    }
    onChange(newFilters);
  };

  if (columns.length === 0) {
    return <p className="text-sm text-muted-foreground">No columns available</p>;
  }

  return (
    <div className="space-y-3">
      {filters.map((filter, index) => (
        <div key={index} className="flex items-center gap-2 flex-wrap">
          {index > 0 && (
            <Select
              value={filter.logic || "AND"}
              onValueChange={(value) => updateFilter(index, { logic: value as "AND" | "OR" })}
            >
              <SelectTrigger className="w-20" data-testid={`select-logic-${index}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          )}
          
          <Select
            value={filter.column}
            onValueChange={(value) => updateFilter(index, { column: value })}
          >
            <SelectTrigger className="w-40" data-testid={`select-column-${index}`}>
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((col) => (
                <SelectItem key={col.name} value={col.name}>
                  {col.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filter.operator}
            onValueChange={(value) => updateFilter(index, { operator: value as RowFilterCondition["operator"] })}
          >
            <SelectTrigger className="w-24" data-testid={`select-operator-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={filter.value}
            onChange={(e) => updateFilter(index, { value: e.target.value })}
            placeholder={filter.operator === "in" ? "value1, value2, ..." : "Value"}
            className="w-40"
            data-testid={`input-value-${index}`}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeFilter(index)}
            data-testid={`button-remove-filter-${index}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addFilter}
        data-testid="button-add-filter"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add Condition
      </Button>
    </div>
  );
}
