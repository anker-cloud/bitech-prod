import { db } from "./db";
import { roles, users, DATA_SOURCES, type DataSourcePermission } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  console.log("Checking if seed data exists...");

  const existingRoles = await db.select().from(roles);
  
  if (existingRoles.length > 0) {
    console.log("Seed data already exists, skipping...");
    return;
  }

  console.log("Seeding database with initial data...");

  const riskAnalystPermissions: DataSourcePermission[] = DATA_SOURCES.map(ds => ({
    dataSourceId: ds.id,
    hasAccess: true,
    tables: [{
      tableName: ds.id.replace("-data-db", ""),
      columns: [],
      allColumns: true,
    }],
  }));

  const [adminRole] = await db.insert(roles).values({
    name: "App Admin",
    description: "Full administrative access to manage roles, users, and all data",
    isAdmin: true,
    permissions: riskAnalystPermissions,
  }).returning();

  const [riskAnalystRole] = await db.insert(roles).values({
    name: "Risk Analyst",
    description: "Full access to all data sources for risk analysis",
    isAdmin: false,
    permissions: riskAnalystPermissions,
  }).returning();

  const marketingPermissions: DataSourcePermission[] = [
    {
      dataSourceId: "crime-data-db",
      hasAccess: false,
      tables: [],
    },
    {
      dataSourceId: "events-data-db",
      hasAccess: true,
      tables: [{
        tableName: "events",
        columns: [],
        allColumns: true,
      }],
    },
    {
      dataSourceId: "traffic-data-db",
      hasAccess: true,
      tables: [{
        tableName: "traffic",
        columns: [],
        allColumns: true,
      }],
    },
    {
      dataSourceId: "weather-data-db",
      hasAccess: false,
      tables: [],
    },
    {
      dataSourceId: "insurance-data-db",
      hasAccess: true,
      tables: [{
        tableName: "insurance",
        columns: ["policy_id", "policy_type", "region", "start_date"],
        allColumns: false,
      }],
    },
  ];

  const [marketingRole] = await db.insert(roles).values({
    name: "Marketing",
    description: "Limited access for marketing analytics",
    isAdmin: false,
    permissions: marketingPermissions,
  }).returning();

  const dataAnalystPermissions: DataSourcePermission[] = [
    {
      dataSourceId: "crime-data-db",
      hasAccess: true,
      tables: [{
        tableName: "crime",
        columns: [],
        allColumns: true,
      }],
    },
    {
      dataSourceId: "events-data-db",
      hasAccess: true,
      tables: [{
        tableName: "events",
        columns: [],
        allColumns: true,
      }],
    },
    {
      dataSourceId: "traffic-data-db",
      hasAccess: true,
      tables: [{
        tableName: "traffic",
        columns: [],
        allColumns: true,
      }],
    },
    {
      dataSourceId: "weather-data-db",
      hasAccess: true,
      tables: [{
        tableName: "weather",
        columns: [],
        allColumns: true,
      }],
    },
    {
      dataSourceId: "insurance-data-db",
      hasAccess: false,
      tables: [],
    },
  ];

  const [dataAnalystRole] = await db.insert(roles).values({
    name: "Data Analyst",
    description: "Access to public datasets for analysis, excluding insurance data",
    isAdmin: false,
    permissions: dataAnalystPermissions,
  }).returning();

  await db.insert(users).values([
    {
      name: "Admin User",
      email: "admin@example.com",
      roleId: adminRole.id,
      cognitoUserId: "demo-admin-cognito-id",
      isActive: true,
    },
    {
      name: "Sarah Johnson",
      email: "sarah.johnson@example.com",
      roleId: riskAnalystRole.id,
      cognitoUserId: "demo-sarah-cognito-id",
      isActive: true,
    },
    {
      name: "Michael Chen",
      email: "michael.chen@example.com",
      roleId: marketingRole.id,
      cognitoUserId: "demo-michael-cognito-id",
      isActive: true,
    },
    {
      name: "Emily Davis",
      email: "emily.davis@example.com",
      roleId: dataAnalystRole.id,
      cognitoUserId: "demo-emily-cognito-id",
      isActive: true,
    },
  ]);

  console.log("Database seeded successfully!");
  console.log("Created roles: App Admin, Risk Analyst, Marketing, Data Analyst");
  console.log("Created 4 demo users");
}
