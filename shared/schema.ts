import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const DATA_SOURCES = [
  { id: "crime-data-db", name: "Crime Data", description: "Crime statistics and incident data", tableName: "crime_data_prd_silver" },
  { id: "events-data-db", name: "Events Data", description: "Event scheduling and tracking data", tableName: "event_data_prd_silver" },
  { id: "insurance-data-db", name: "Insurance Data", description: "Policy and claims data for insurance analytics", tableName: "policy_claims_data_silver" },
  { id: "traffic-data-db", name: "Traffic Data", description: "Traffic flow and incident data", tableName: "traffic_data_prd_silver" },
  { id: "weather-data-db", name: "Weather Data", description: "Weather conditions and forecasts", tableName: "weather_data_prd_silver" },
] as const;

export type DataSourceId = typeof DATA_SOURCES[number]["id"];

export interface RowFilterCondition {
  column: string;
  operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in";
  value: string;
  logic?: "AND" | "OR";
}

export interface TablePermission {
  tableName: string;
  columns: string[];
  allColumns: boolean;
  allRows: boolean;
  rowFilters?: RowFilterCondition[];
}

export interface DataSourcePermission {
  dataSourceId: DataSourceId;
  hasAccess: boolean;
  tables: TablePermission[];
}

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  isAdmin: boolean("is_admin").notNull().default(false),
  permissions: jsonb("permissions").$type<DataSourcePermission[]>().notNull().default([]),
  iamRoleArn: text("iam_role_arn"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cognitoUserId: text("cognito_user_id").unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  roleId: varchar("role_id").references(() => roles.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const queryHistory = pgTable("query_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  dataSourceId: text("data_source_id").notNull(),
  sqlQuery: text("sql_query").notNull(),
  executionTimeMs: integer("execution_time_ms"),
  rowCount: integer("row_count"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const queryHistoryRelations = relations(queryHistory, ({ one }) => ({
  user: one(users, {
    fields: [queryHistory.userId],
    references: [users.id],
  }),
}));

export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertQueryHistorySchema = createInsertSchema(queryHistory).omit({
  id: true,
  createdAt: true,
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type QueryHistory = typeof queryHistory.$inferSelect;
export type InsertQueryHistory = z.infer<typeof insertQueryHistorySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginCredentials = z.infer<typeof loginSchema>;

export const filterOperators = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not Equals" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Not Contains" },
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
  { value: "greater_or_equal", label: "Greater or Equal" },
  { value: "less_or_equal", label: "Less or Equal" },
] as const;

export type FilterOperator = typeof filterOperators[number]["value"];

export interface QueryFilter {
  column: string;
  operator: FilterOperator;
  value: string;
  logic?: "AND" | "OR";
}

export interface QueryConfig {
  dataSourceId: DataSourceId;
  selectedColumns: string[];
  filters: QueryFilter[];
  customSql?: string;
  isCustomMode: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role | null;
  isAdmin: boolean;
  accessToken: string;
}
