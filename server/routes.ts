import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authenticateUser, createCognitoUser, updateCognitoUser, deleteCognitoUser, setUserPassword } from "./aws/cognito";
import { createIAMRole, updateIAMRole, deleteIAMRole } from "./aws/iam";
import { grantLakeFormationPermissions, revokeLakeFormationPermissions, updateLakeFormationPermissions } from "./aws/lakeformation";
import { getDataSourceSchemas, getDataSourceColumns } from "./aws/glue";
import { executeQuery } from "./aws/athena";
import { authMiddleware, adminMiddleware, validateDataSourceAccess, type AuthenticatedRequest } from "./middleware/auth";
import { insertRoleSchema, insertUserSchema, DATA_SOURCES, type DataSourcePermission } from "@shared/schema";
import { z } from "zod";

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

      const { name, description, isAdmin, permissions } = req.body;

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
      const { name, description, isAdmin, permissions } = req.body;
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
    try {
      const dataSourceId = req.params.id;
      
      if (!validateDataSourceAccess(req, dataSourceId)) {
        return res.status(403).json({ message: "Access denied to this data source" });
      }

      const columns = await getDataSourceColumns(dataSourceId);
      res.json(columns);
    } catch (error) {
      console.error("Get columns error:", error);
      res.status(500).json({ message: "Failed to fetch columns" });
    }
  });

  app.post("/api/query/execute", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { sql, dataSourceId } = req.body;

      if (!sql?.trim() || !dataSourceId) {
        return res.status(400).json({ message: "SQL and data source are required" });
      }

      const dataSource = DATA_SOURCES.find(ds => ds.id === dataSourceId);
      if (!dataSource) {
        return res.status(400).json({ message: "Invalid data source" });
      }

      if (!validateDataSourceAccess(req, dataSourceId)) {
        return res.status(403).json({ 
          message: "Access denied: You do not have permission to query this data source" 
        });
      }

      const result = await executeQuery(sql, dataSourceId);
      res.json(result);
    } catch (error) {
      console.error("Query execution error:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Query execution failed" 
      });
    }
  });

  return httpServer;
}
