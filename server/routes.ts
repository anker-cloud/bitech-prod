import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authenticateUser, createCognitoUser, updateCognitoUser, deleteCognitoUser, setUserPassword } from "./aws/cognito";
import { createIAMRole, updateIAMRole, deleteIAMRole } from "./aws/iam";
import { grantLakeFormationPermissions, revokeLakeFormationPermissions, updateLakeFormationPermissions } from "./aws/lakeformation";
import { getDataSourceSchemas, getDataSourceColumns } from "./aws/glue";
import { executeQuery } from "./aws/athena";
import { authMiddleware, adminMiddleware, validateDataSourceAccess, getRowFilters, buildRowFilterWhereClause, type AuthenticatedRequest } from "./middleware/auth";
import { insertRoleSchema, insertUserSchema, DATA_SOURCES, DATA_SOURCE_SHORT_NAMES, type DataSourcePermission, type Role } from "@shared/schema";
import { getActiveDatabase } from "./aws/config";
import { z } from "zod";
import crypto from "crypto";
import { normalizeGermanExpr, normalizeGermanValue } from "@shared/sql-normalize";

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `dc4ai_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 12);
  return { key, hash, prefix };
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const tokens = await authenticateUser(email, password);
      
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        return res.status(401).json({ message: "User not found in system" });
      }

      if (!user.isActive) {
        return res.status(401).json({ message: "Account is inactive" });
      }

      const role = user.roleId ? await storage.getRole(user.roleId) : null;

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role,
          isAdmin: role?.isAdmin || false,
          accessToken: tokens.accessToken,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(401).json({ 
        message: error instanceof Error ? error.message : "Authentication failed" 
      });
    }
  });

  // Validate token and return current user info
  app.get("/api/auth/me", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      if (!user.isActive) {
        return res.status(401).json({ message: "Account is inactive" });
      }

      const role = user.roleId ? await storage.getRole(user.roleId) : null;

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role,
        isAdmin: role?.isAdmin || false,
      });
    } catch (error) {
      console.error("Get current user error:", error);
      res.status(401).json({ message: "Session validation failed" });
    }
  });

  // Public endpoint to check if setup is needed
  app.get("/api/setup/status", async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const roles = await storage.getAllRoles();
      const adminRole = roles.find(r => r.isAdmin);
      
      res.json({
        needsSetup: users.length === 0,
        hasAdminRole: !!adminRole,
        adminRoleId: adminRole?.id || null,
      });
    } catch (error) {
      console.error("Setup status error:", error);
      res.status(500).json({ message: "Failed to check setup status" });
    }
  });

  // Public endpoint to create initial admin user (only works when no users exist)
  // Uses double-check pattern for race condition protection
  app.post("/api/setup/admin", async (req: Request, res: Response) => {
    try {
      // First check - early exit for obvious cases
      const existingUsers = await storage.getAllUsers();
      if (existingUsers.length > 0) {
        return res.status(403).json({ 
          message: "Setup already completed. Admin user can only be created when no users exist." 
        });
      }

      const { name, email, password } = req.body;
      
      if (!name || !email || !password) {
        return res.status(400).json({ message: "Name, email, and password are required" });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      // Get or create admin role
      const roles = await storage.getAllRoles();
      let adminRole = roles.find(r => r.isAdmin);
      
      if (!adminRole) {
        // Create admin role with full permissions
        const fullAccessPermissions: DataSourcePermission[] = DATA_SOURCES.map(ds => ({
          dataSourceId: ds.id,
          hasAccess: true,
          tables: [{
            tableName: ds.tableName,
            columns: [],
            allColumns: true,
            allRows: true,
          }],
        }));

        adminRole = await storage.createRole({
          name: "App Admin",
          description: "Full administrative access to manage roles, users, and all data",
          isAdmin: true,
          permissions: fullAccessPermissions,
        });
      }

      // Create user in Cognito first (before DB to avoid orphaned DB records)
      const cognitoUserId = await createCognitoUser(email, password, name);

      // Second check - right before insert to prevent race conditions
      const usersBeforeInsert = await storage.getAllUsers();
      if (usersBeforeInsert.length > 0) {
        // Another request created a user while we were processing
        // Try to clean up the Cognito user we just created
        try {
          await deleteCognitoUser(email);
        } catch (cleanupError) {
          console.error("Failed to cleanup Cognito user after race condition:", cleanupError);
        }
        return res.status(403).json({ 
          message: "Setup already completed by another request." 
        });
      }

      // Create user in database
      const user = await storage.createUser({
        name,
        email,
        roleId: adminRole.id,
        cognitoUserId,
        isActive: true,
      });

      // Authenticate and return tokens
      const tokens = await authenticateUser(email, password);

      res.status(201).json({
        message: "Admin user created successfully",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: adminRole,
          isAdmin: true,
          accessToken: tokens.accessToken,
        },
      });
    } catch (error) {
      console.error("Setup admin error:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to create admin user" 
      });
    }
  });

  app.get("/api/roles", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      console.error("Get roles error:", error);
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  app.get("/api/roles/user-counts", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const counts = await storage.getRoleUserCounts();
      res.json(counts);
    } catch (error) {
      console.error("Get role user counts error:", error);
      res.status(500).json({ message: "Failed to fetch user counts" });
    }
  });

  app.get("/api/roles/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      const role = await storage.getRole(req.params.id);
      
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }
      
      res.json(role);
    } catch (error) {
      console.error("Get role error:", error);
      res.status(500).json({ message: "Failed to fetch role" });
    }
  });

  app.post("/api/roles", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validationResult = insertRoleSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid role data", 
          errors: validationResult.error.flatten() 
        });
      }

      const { name, description, isAdmin, canGenerateApiKeys, permissions } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ message: "Role name is required" });
      }

      const existingRole = await storage.getRoleByName(name.trim());
      if (existingRole) {
        return res.status(400).json({ message: "A role with this name already exists" });
      }

      let iamRoleArn: string | undefined;
      try {
        iamRoleArn = await createIAMRole(name, permissions || []);
        
        if (iamRoleArn && permissions) {
          await grantLakeFormationPermissions(iamRoleArn, permissions);
        }
      } catch (awsError) {
        console.error("AWS provisioning error:", awsError);
      }

      const role = await storage.createRole({
        name: name.trim(),
        description: description?.trim() || null,
        isAdmin: isAdmin || false,
        canGenerateApiKeys: canGenerateApiKeys || false,
        permissions: permissions || [],
        iamRoleArn,
      });

      res.status(201).json(role);
    } catch (error) {
      console.error("Create role error:", error);
      res.status(500).json({ message: "Failed to create role" });
    }
  });

  app.patch("/api/roles/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      const { name, description, isAdmin, canGenerateApiKeys, permissions } = req.body;
      const role = await storage.getRole(req.params.id);

      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }

      if (name && name !== role.name) {
        const existingRole = await storage.getRoleByName(name.trim());
        if (existingRole) {
          return res.status(400).json({ message: "A role with this name already exists" });
        }
      }

      if (role.iamRoleArn && permissions) {
        try {
          await updateIAMRole(role.name, permissions);
          await updateLakeFormationPermissions(
            role.iamRoleArn,
            role.permissions || [],
            permissions
          );
        } catch (awsError) {
          console.error("AWS update error:", awsError);
        }
      }

      const updatedRole = await storage.updateRole(req.params.id, {
        name: name?.trim() || role.name,
        description: description?.trim() ?? role.description,
        isAdmin: isAdmin ?? role.isAdmin,
        canGenerateApiKeys: canGenerateApiKeys ?? role.canGenerateApiKeys,
        permissions: permissions ?? role.permissions,
      });

      res.json(updatedRole);
    } catch (error) {
      console.error("Update role error:", error);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  app.delete("/api/roles/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      const role = await storage.getRole(req.params.id);

      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }

      const userCounts = await storage.getRoleUserCounts();
      if (userCounts[role.id] > 0) {
        return res.status(400).json({ 
          message: "Cannot delete role with assigned users. Please reassign users first." 
        });
      }

      if (role.iamRoleArn) {
        try {
          await revokeLakeFormationPermissions(role.iamRoleArn, role.permissions || []);
          await deleteIAMRole(role.name);
        } catch (awsError) {
          console.error("AWS cleanup error:", awsError);
        }
      }

      await storage.deleteRole(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete role error:", error);
      res.status(500).json({ message: "Failed to delete role" });
    }
  });

  app.get("/api/users", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      const user = await storage.getUser(req.params.id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const role = user.roleId ? await storage.getRole(user.roleId) : undefined;
      
      res.json({ ...user, role });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/users", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, email, password, roleId } = req.body;

      if (!name?.trim() || !email?.trim() || !password || !roleId) {
        return res.status(400).json({ 
          message: "Name, email, password, and role are required" 
        });
      }

      const existingUser = await storage.getUserByEmail(email.trim());
      if (existingUser) {
        return res.status(400).json({ message: "A user with this email already exists" });
      }

      const role = await storage.getRole(roleId);
      if (!role) {
        return res.status(400).json({ message: "Selected role does not exist" });
      }

      let cognitoUserId: string | undefined;
      try {
        cognitoUserId = await createCognitoUser(email.trim(), password, name.trim());
      } catch (cognitoError) {
        console.error("Cognito user creation error:", cognitoError);
        return res.status(500).json({ 
          message: "Failed to create user in AWS Cognito" 
        });
      }

      const user = await storage.createUser({
        name: name.trim(),
        email: email.trim(),
        roleId,
        cognitoUserId,
        isActive: true,
      });

      res.status(201).json({ ...user, role });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.patch("/api/users/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      const { name, email, password, roleId, isActive } = req.body;
      const user = await storage.getUser(req.params.id);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (email && email !== user.email) {
        const existingUser = await storage.getUserByEmail(email.trim());
        if (existingUser) {
          return res.status(400).json({ message: "A user with this email already exists" });
        }
      }

      if (roleId) {
        const role = await storage.getRole(roleId);
        if (!role) {
          return res.status(400).json({ message: "Selected role does not exist" });
        }
      }

      try {
        if (name || email) {
          await updateCognitoUser(user.email, {
            name: name?.trim(),
            newEmail: email && email !== user.email ? email.trim() : undefined,
          });
        }

        if (password) {
          await setUserPassword(email?.trim() || user.email, password);
        }
      } catch (cognitoError) {
        console.error("Cognito update error:", cognitoError);
      }

      const updatedUser = await storage.updateUser(req.params.id, {
        name: name?.trim() || user.name,
        email: email?.trim() || user.email,
        roleId: roleId ?? user.roleId,
        isActive: isActive ?? user.isActive,
      });

      const role = updatedUser?.roleId ? await storage.getRole(updatedUser.roleId) : undefined;
      res.json({ ...updatedUser, role });
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", authMiddleware, adminMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      const user = await storage.getUser(req.params.id);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const userApiKeys = await storage.getApiKeysByUserId(req.params.id);
      const activeApiKeys = userApiKeys.filter(key => !key.isRevoked);
      
      if (activeApiKeys.length > 0) {
        return res.status(400).json({ 
          message: `This user has ${activeApiKeys.length} active API key(s). Please delete or revoke all API keys before deleting the user.`,
          apiKeyCount: activeApiKeys.length
        });
      }

      await storage.deleteApiKeysByUserId(req.params.id);

      try {
        await deleteCognitoUser(user.email);
      } catch (cognitoError) {
        console.error("Cognito delete error:", cognitoError);
      }

      await storage.deleteUser(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.get("/api/data-sources/schemas", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const schemas = await getDataSourceSchemas();
      res.json(schemas);
    } catch (error) {
      console.error("Get schemas error:", error);
      res.status(500).json({ message: "Failed to fetch data source schemas" });
    }
  });

  app.get("/api/data-sources/:id/columns", authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    const dataSourceId = req.params.id;
    try {
      if (!validateDataSourceAccess(req, dataSourceId)) {
        return res.status(403).json({ message: "Access Denied!! You do not have Lake Formation permissions to access this data source." });
      }

      const columns = await getDataSourceColumns(dataSourceId);
      res.json(columns);
    } catch (error: any) {
      console.error("Get columns error:", error);
      const errorName = error?.name || "Unknown";
      res.status(500).json({ message: `Failed to fetch columns for ${dataSourceId}: ${errorName}` });
    }
  });

  app.post("/api/query/execute", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { sql, dataSourceId, dataSourceIds } = req.body;
      const dsIds: string[] = dataSourceIds || (dataSourceId ? [dataSourceId] : []);

      if (!sql?.trim() || dsIds.length === 0) {
        return res.status(400).json({ message: "SQL and data source are required" });
      }

      const resolvedSources = dsIds.map((id: string) => {
        const ds = DATA_SOURCES.find(d => d.id === id);
        if (!ds) throw new Error(`Invalid data source: ${id}`);
        return ds;
      });

      for (const id of dsIds) {
        if (!validateDataSourceAccess(req, id)) {
          return res.status(403).json({ 
            message: "Access Denied!! You do not have Lake Formation permissions to access this data source." 
          });
        }
      }

      let modifiedSql = sql;
      const isMultiTable = dsIds.length > 1;

      if (isMultiTable) {
        const allFilterClauses: string[] = [];
        for (let i = 0; i < dsIds.length; i++) {
          const ds = resolvedSources[i];
          const alias = `t${i + 1}`;
          const { allRows, filters } = getRowFilters(req, ds.id, ds.tableName);
          if (!allRows && filters.length > 0) {
            const clause = buildRowFilterWhereClause(filters, undefined, alias);
            if (clause) allFilterClauses.push(`(${clause})`);
          }
        }
        if (allFilterClauses.length > 0) {
          const combinedFilter = allFilterClauses.join(" AND ");
          const normalizedSql = sql.replace(/\s+/g, ' ');
          const upperSql = normalizedSql.toUpperCase();
          const whereMatch = upperSql.match(/\sWHERE\s/i);
          const groupByMatch = upperSql.match(/\sGROUP\s+BY\s/i);
          const orderByMatch = upperSql.match(/\sORDER\s+BY\s/i);
          const limitMatch = upperSql.match(/\sLIMIT\s/i);
          const whereIndex = whereMatch ? upperSql.indexOf(whereMatch[0]) : -1;
          const groupByIndex = groupByMatch ? upperSql.indexOf(groupByMatch[0]) : -1;
          const orderByIndex = orderByMatch ? upperSql.indexOf(orderByMatch[0]) : -1;
          const limitIndex = limitMatch ? upperSql.indexOf(limitMatch[0]) : -1;
          if (whereIndex !== -1 && whereMatch) {
            const afterWhere = whereIndex + whereMatch[0].length;
            modifiedSql = normalizedSql.slice(0, afterWhere) + `${combinedFilter} AND (` + normalizedSql.slice(afterWhere) + ")";
          } else {
            let insertPosition = normalizedSql.length;
            if (groupByIndex !== -1) insertPosition = Math.min(insertPosition, groupByIndex);
            if (orderByIndex !== -1) insertPosition = Math.min(insertPosition, orderByIndex);
            if (limitIndex !== -1) insertPosition = Math.min(insertPosition, limitIndex);
            modifiedSql = normalizedSql.slice(0, insertPosition) + ` WHERE ${combinedFilter}` + normalizedSql.slice(insertPosition);
          }
        }
      } else {
        const ds = resolvedSources[0];
        const { allRows, filters } = getRowFilters(req, ds.id, ds.tableName);
        if (!allRows && filters.length > 0) {
          const rowFilterClause = buildRowFilterWhereClause(filters);
          if (rowFilterClause) {
            const normalizedSql = sql.replace(/\s+/g, ' ');
            const upperSql = normalizedSql.toUpperCase();
            const whereMatch = upperSql.match(/\sWHERE\s/i);
            const groupByMatch = upperSql.match(/\sGROUP\s+BY\s/i);
            const orderByMatch = upperSql.match(/\sORDER\s+BY\s/i);
            const limitMatch = upperSql.match(/\sLIMIT\s/i);
            const whereIndex = whereMatch ? upperSql.indexOf(whereMatch[0]) : -1;
            const groupByIndex = groupByMatch ? upperSql.indexOf(groupByMatch[0]) : -1;
            const orderByIndex = orderByMatch ? upperSql.indexOf(orderByMatch[0]) : -1;
            const limitIndex = limitMatch ? upperSql.indexOf(limitMatch[0]) : -1;
            if (whereIndex !== -1 && whereMatch) {
              const afterWhere = whereIndex + whereMatch[0].length;
              modifiedSql = normalizedSql.slice(0, afterWhere) + `(${rowFilterClause}) AND (` + normalizedSql.slice(afterWhere) + ")";
            } else {
              let insertPosition = normalizedSql.length;
              if (groupByIndex !== -1) insertPosition = Math.min(insertPosition, groupByIndex);
              if (orderByIndex !== -1) insertPosition = Math.min(insertPosition, orderByIndex);
              if (limitIndex !== -1) insertPosition = Math.min(insertPosition, limitIndex);
              modifiedSql = normalizedSql.slice(0, insertPosition) + ` WHERE ${rowFilterClause}` + normalizedSql.slice(insertPosition);
            }
          }
        }
      }

      const result = await executeQuery(modifiedSql, getActiveDatabase());
      res.json(result);
    } catch (error) {
      console.error("Query execution error:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Query execution failed" 
      });
    }
  });

  // API Key Management Routes
  app.get("/api/api-keys", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const keys = await storage.getApiKeysByUserId(req.user!.id);
      res.json(keys.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        isRevoked: k.isRevoked,
        createdAt: k.createdAt,
      })));
    } catch (error) {
      console.error("Get API keys error:", error);
      res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  app.post("/api/api-keys", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ message: "API key name is required" });
      }

      const { key, hash, prefix } = generateApiKey();

      const apiKey = await storage.createApiKey({
        userId: req.user!.id,
        name: name.trim(),
        keyHash: hash,
        keyPrefix: prefix,
        isRevoked: false,
      });

      res.status(201).json({
        id: apiKey.id,
        name: apiKey.name,
        key: key,
        keyPrefix: prefix,
        createdAt: apiKey.createdAt,
        message: "Save this API key - it will not be shown again",
      });
    } catch (error) {
      console.error("Create API key error:", error);
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  app.delete("/api/api-keys/:id", authMiddleware, async (req: AuthenticatedRequest<{ id: string }>, res: Response) => {
    try {
      await storage.revokeApiKey(req.params.id, req.user!.id);
      res.status(204).send();
    } catch (error) {
      console.error("Revoke API key error:", error);
      const message = error instanceof Error ? error.message : "Failed to revoke API key";
      res.status(400).json({ message });
    }
  });

  // Public API Endpoint for data fetching
  app.get("/api/v1/fetch", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers["x-api-key"] as string;
      const dataSource = req.headers["x-data-source"] as string;
      const dataSourcesHeader = req.headers["x-data-sources"] as string | undefined;
      const tableName = req.headers["x-table"] as string | undefined;
      const acceptHeader = req.headers["accept"] as string || "application/json";

      if (!apiKey) {
        return res.status(401).json({ message: "Missing x-api-key header" });
      }

      if (!dataSource && !dataSourcesHeader) {
        return res.status(400).json({ message: "Missing required header: x-data-source (single source) or x-data-sources (multi-source JOIN, comma-separated)" });
      }

      const keyHash = hashApiKey(apiKey);
      const storedKey = await storage.getApiKeyByHash(keyHash);

      if (!storedKey) {
        return res.status(401).json({ message: "Invalid or revoked API key" });
      }

      const user = await storage.getUser(storedKey.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: "User account is inactive" });
      }

      const role = user.roleId ? await storage.getRole(user.roleId) : null;
      if (!role) {
        return res.status(403).json({ message: "User has no assigned role" });
      }

      // ── MULTI-SOURCE LEFT JOIN PATH ───────────────────────────────────────
      if (dataSourcesHeader) {
        const sourceIds = dataSourcesHeader.split(",").map(s => s.trim()).filter(Boolean);

        if (sourceIds.length < 2) {
          return res.status(400).json({ message: "x-data-sources requires at least 2 comma-separated sources. For a single source use x-data-source instead." });
        }

        const resolvedSources = sourceIds.map(id => {
          const resolvedId = DATA_SOURCE_SHORT_NAMES[id] || id;
          const config = DATA_SOURCES.find(ds => ds.id === resolvedId);
          return { originalId: id, resolvedId, config };
        });

        const invalidSources = resolvedSources.filter(s => !s.config);
        if (invalidSources.length > 0) {
          return res.status(400).json({
            message: `Invalid data source(s): ${invalidSources.map(s => s.originalId).join(", ")}`,
            validSources: [...DATA_SOURCES.map(ds => ds.shortName), ...DATA_SOURCES.map(ds => ds.id)],
          });
        }

        const permissions = role.permissions as DataSourcePermission[] || [];

        for (const src of resolvedSources) {
          const perm = permissions.find(p => p.dataSourceId === src.resolvedId);
          if (!role.isAdmin && (!perm || !perm.hasAccess)) {
            return res.status(403).json({ message: `Access Denied!! You do not have Lake Formation permissions to access: ${src.originalId}` });
          }
        }

        let columnsPerSource: { name: string; type: string }[][];
        try {
          columnsPerSource = await Promise.all(resolvedSources.map(src => getDataSourceColumns(src.resolvedId!)));
        } catch (err) {
          return res.status(500).json({ message: `Failed to fetch schema: ${err instanceof Error ? err.message : String(err)}` });
        }

        const colNameSets = columnsPerSource.map(cols => new Set(cols.map(c => c.name)));
        const joinColumns = [...colNameSets[0]].filter(name => colNameSets.every(set => set.has(name)));

        if (joinColumns.length === 0) {
          return res.status(400).json({
            message: "No common columns found between the selected data sources. Sources must share at least one column name to JOIN.",
            sources: resolvedSources.map((src, i) => ({ id: src.resolvedId, columns: columnsPerSource[i].map(c => c.name) })),
          });
        }

        const castColumns = new Set<string>();
        for (const jc of joinColumns) {
          const types = columnsPerSource.map(cols => cols.find(c => c.name === jc)?.type || "string");
          if (types.some(t => t !== types[0])) castColumns.add(jc);
        }

        const columnSourceIndex: Record<string, number> = {};
        for (let i = 0; i < resolvedSources.length; i++) {
          for (const col of columnsPerSource[i]) {
            if (!(col.name in columnSourceIndex)) columnSourceIndex[col.name] = i;
          }
        }

        const allColumnNames = Object.keys(columnSourceIndex);
        const aliases = resolvedSources.map((_, i) => `t${i + 1}`);

        const requestedColumnsParam = req.query.columns as string | undefined;
        let requestedColumns = requestedColumnsParam
          ? requestedColumnsParam.split(",").map(c => c.trim()).filter(Boolean)
          : allColumnNames;

        if (!role.isAdmin) {
          for (let i = 0; i < resolvedSources.length; i++) {
            const src = resolvedSources[i];
            const perm = permissions.find(p => p.dataSourceId === src.resolvedId);
            const tablePerm = perm?.tables?.find(t => t.tableName === src.config!.tableName);
            if (tablePerm && !tablePerm.allColumns) {
              const allowedCols = new Set(tablePerm.columns || []);
              for (const reqCol of requestedColumns) {
                const ownerIdx = columnSourceIndex[reqCol];
                if (ownerIdx === i && !joinColumns.includes(reqCol) && !allowedCols.has(reqCol)) {
                  return res.status(403).json({
                    message: `Access Denied!! You do not have Lake Formation permissions to access column: ${reqCol} in ${src.originalId}`,
                  });
                }
              }
              requestedColumns = requestedColumns.filter(c => columnSourceIndex[c] !== i || joinColumns.includes(c) || allowedCols.has(c));
            }
          }
        }

        const colAlias = (colName: string) => {
          if (joinColumns.includes(colName)) return aliases[0];
          const ownerIdx = columnSourceIndex[colName] ?? 0;
          return aliases[ownerIdx];
        };

        const selectParts = requestedColumns.map(col => `${colAlias(col)}."${col.replace(/"/g, '""')}"`);
        const activeDatabase = getActiveDatabase();
        let sql = `SELECT ${selectParts.join(", ")}\nFROM "${resolvedSources[0].config!.tableName}" ${aliases[0]}`;

        for (let i = 1; i < resolvedSources.length; i++) {
          const conditions = joinColumns.map(jc => {
            const needsCast = castColumns.has(jc);
            const left = needsCast ? `CAST(${aliases[0]}."${jc}" AS VARCHAR)` : `${aliases[0]}."${jc}"`;
            const right = needsCast ? `CAST(${aliases[i]}."${jc}" AS VARCHAR)` : `${aliases[i]}."${jc}"`;
            return `${left} = ${right}`;
          }).join(" AND ");
          sql += `\nLEFT JOIN "${resolvedSources[i].config!.tableName}" ${aliases[i]} ON ${conditions}`;
        }

        const filterClauses: string[] = [];
        const filterParams = Object.entries(req.query).filter(([key]) => !["columns", "limit"].includes(key));
        for (const [column, value] of filterParams) {
          if (!joinColumns.includes(column)) continue;
          const safeValue = String(value).replace(/'/g, "''");
          const colRef = `${aliases[0]}."${column.replace(/"/g, '""')}"`;
          filterClauses.push(`${normalizeGermanExpr(colRef)} = '${normalizeGermanValue(safeValue)}'`);
        }

        for (let i = 0; i < resolvedSources.length; i++) {
          const src = resolvedSources[i];
          const perm = permissions.find(p => p.dataSourceId === src.resolvedId);
          const tablePerm = perm?.tables?.find(t => t.tableName === src.config!.tableName);
          if (!role.isAdmin && tablePerm && !tablePerm.allRows && tablePerm.rowFilters) {
            for (const filter of tablePerm.rowFilters) {
              const safeCol = filter.column.replace(/"/g, '""');
              const safeVal = String(filter.value).replace(/'/g, "''");
              const isStringOp = ['equals', 'not_equals', 'contains', 'in'].includes(filter.operator);
              const colExpr = isStringOp ? normalizeGermanExpr(`${aliases[i]}."${safeCol}"`) : `${aliases[i]}."${safeCol}"`;
              const valExpr = isStringOp ? normalizeGermanValue(safeVal) : safeVal;
              let clause: string;
              switch (filter.operator) {
                case "equals": clause = `${colExpr} = '${valExpr}'`; break;
                case "not_equals": clause = `${colExpr} != '${valExpr}'`; break;
                case "contains": clause = `${colExpr} LIKE '%${valExpr}%'`; break;
                case "greater_than": clause = `${aliases[i]}."${safeCol}" > '${safeVal}'`; break;
                case "less_than": clause = `${aliases[i]}."${safeCol}" < '${safeVal}'`; break;
                case "in": {
                  const vals = safeVal.split(",").map(v => `'${normalizeGermanValue(v.trim())}'`).join(", ");
                  clause = `${colExpr} IN (${vals})`;
                  break;
                }
                default: clause = `${colExpr} = '${valExpr}'`;
              }
              filterClauses.push(clause);
            }
          }
        }

        const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(" AND ")}` : "";
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
        sql += `\n${whereClause}\nLIMIT ${limit}`;

        const result = await executeQuery(sql, activeDatabase);

        if (acceptHeader.includes("text/csv")) {
          res.setHeader("Content-Type", "text/csv");
          res.setHeader("Content-Disposition", "attachment; filename=data.csv");
          if (result.rows.length === 0) return res.send("");
          const header = result.columns.join(",");
          const rows = result.rows.map(row =>
            result.columns.map(col => {
              const val = row[col];
              if (val === null || val === undefined) return "";
              const str = String(val);
              return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(",")
          );
          return res.send([header, ...rows].join("\n"));
        }

        return res.json({
          meta: {
            totalRows: result.totalRows,
            limit,
            joinMode: true,
            sources: resolvedSources.map(s => s.config?.shortName || s.resolvedId),
            joinColumns,
            executionTimeMs: result.executionTimeMs,
            columns: result.columns,
          },
          data: result.rows,
        });
      }
      // ── END MULTI-SOURCE PATH ─────────────────────────────────────────────

      const resolvedDataSourceId = DATA_SOURCE_SHORT_NAMES[dataSource] || dataSource;
      const dataSourceConfig = DATA_SOURCES.find(ds => ds.id === resolvedDataSourceId);
      if (!dataSourceConfig) {
        return res.status(400).json({ 
          message: "Invalid data source",
          validSources: [...DATA_SOURCES.map(ds => ds.shortName), ...DATA_SOURCES.map(ds => ds.id)]
        });
      }

      const permissions = role.permissions as DataSourcePermission[] || [];
      const dataSourcePermission = permissions.find(p => p.dataSourceId === resolvedDataSourceId);
      
      if (!role.isAdmin && (!dataSourcePermission || !dataSourcePermission.hasAccess)) {
        return res.status(403).json({ message: "Access Denied!! You do not have Lake Formation permissions to access this data source." });
      }

      const resolvedTableName = tableName || dataSourceConfig.tableName;
      const activeDatabase = getActiveDatabase();
      const tablePermission = dataSourcePermission?.tables?.find(t => t.tableName === resolvedTableName);

      // Parse query parameters
      const columns = req.query.columns as string | undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;

      // Build column list
      let columnList = "*";
      if (columns) {
        const requestedColumns = columns.split(",").map(c => c.trim());
        
        // Check column permissions if not admin
        if (!role.isAdmin && tablePermission && !tablePermission.allColumns) {
          const allowedColumns = tablePermission.columns || [];
          const invalidColumns = requestedColumns.filter(c => !allowedColumns.includes(c));
          if (invalidColumns.length > 0) {
            return res.status(403).json({ 
              message: `Access Denied!! You do not have Lake Formation permissions to access the following columns: ${invalidColumns.join(", ")}`,
              allowedColumns 
            });
          }
        }
        
        columnList = requestedColumns.map(c => `"${c.replace(/"/g, '""')}"`).join(", ");
      } else if (!role.isAdmin && tablePermission && !tablePermission.allColumns) {
        const allowedColumns = tablePermission.columns || [];
        if (allowedColumns.length > 0) {
          columnList = allowedColumns.map(c => `"${c.replace(/"/g, '""')}"`).join(", ");
        }
      }

      // Build filters from query params (equals only, with German char normalization + case insensitivity)
      const filterParams = Object.entries(req.query)
        .filter(([key]) => !["columns", "limit", "offset"].includes(key));
      
      const filterClauses: string[] = [];
      for (const [column, value] of filterParams) {
        const safeColumn = column.replace(/"/g, '""');
        const safeValue = String(value).replace(/'/g, "''");
        const normalizedCol = normalizeGermanExpr(`"${safeColumn}"`);
        const normalizedVal = normalizeGermanValue(safeValue);
        filterClauses.push(`${normalizedCol} = '${normalizedVal}'`);
      }

      // Apply row-level permissions
      if (!role.isAdmin && tablePermission && !tablePermission.allRows && tablePermission.rowFilters) {
        for (const filter of tablePermission.rowFilters) {
          const safeCol = filter.column.replace(/"/g, '""');
          const safeVal = String(filter.value).replace(/'/g, "''");
          const isStringOp = ['equals', 'not_equals', 'contains', 'in'].includes(filter.operator);
          const colExpr = isStringOp ? normalizeGermanExpr(`"${safeCol}"`) : `"${safeCol}"`;
          const valExpr = isStringOp ? normalizeGermanValue(safeVal) : safeVal;
          
          let clause: string;
          switch (filter.operator) {
            case "equals":
              clause = `${colExpr} = '${valExpr}'`;
              break;
            case "not_equals":
              clause = `${colExpr} != '${valExpr}'`;
              break;
            case "contains":
              clause = `${colExpr} LIKE '%${valExpr}%'`;
              break;
            case "greater_than":
              clause = `"${safeCol}" > '${safeVal}'`;
              break;
            case "less_than":
              clause = `"${safeCol}" < '${safeVal}'`;
              break;
            case "in":
              const values = safeVal.split(",").map(v => `'${normalizeGermanValue(v.trim())}'`).join(", ");
              clause = `${colExpr} IN (${values})`;
              break;
            default:
              clause = `${colExpr} = '${valExpr}'`;
          }
          filterClauses.push(clause);
        }
      }

      const whereClause = filterClauses.length > 0 ? `WHERE ${filterClauses.join(" AND ")}` : "";
      // Note: Athena doesn't support OFFSET, so we only use LIMIT for now
      const sql = `SELECT ${columnList} FROM "${resolvedTableName}" ${whereClause} LIMIT ${limit}`;

      const result = await executeQuery(sql, activeDatabase);

      // Return CSV if requested
      if (acceptHeader.includes("text/csv")) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=data.csv");
        
        if (result.rows.length === 0) {
          return res.send("");
        }

        const header = result.columns.join(",");
        const rows = result.rows.map(row => 
          result.columns.map(col => {
            const val = row[col];
            if (val === null || val === undefined) return "";
            const str = String(val);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          }).join(",")
        );
        
        return res.send([header, ...rows].join("\n"));
      }

      // Default JSON response - metadata first, then data
      res.json({
        meta: {
          totalRows: result.totalRows,
          limit,
          offset,
          executionTimeMs: result.executionTimeMs,
          columns: result.columns,
        },
        data: result.rows,
      });
    } catch (error) {
      console.error("API fetch error:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Query execution failed" 
      });
    }
  });

  return httpServer;
}
