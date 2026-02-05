import type { Request, Response, NextFunction } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { storage } from "../storage";
import type { User, Role, RowFilterCondition } from "@shared/schema";

export interface AuthenticatedRequest<P = ParamsDictionary> extends Request<P> {
  user?: User & { role?: Role };
  accessToken?: string;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      tokenUse: "access",
      clientId: process.env.COGNITO_CLIENT_ID!,
    });
  }
  return verifier;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const token = authHeader.substring(7);

    let cognitoUserId: string;

    try {
      const payload = await getVerifier().verify(token);
      // The 'sub' claim contains the Cognito user ID
      cognitoUserId = (payload.sub || payload.username) as string;
    } catch (verifyError) {
      console.error("Token verification failed:", verifyError);
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const user = await storage.getUserByCognitoId(cognitoUserId);
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: "Account is inactive" });
    }

    const role = user.roleId ? await storage.getRole(user.roleId) : undefined;

    req.user = { ...user, role };
    req.accessToken = token;
    
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
}

export function adminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.role?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export function validateDataSourceAccess(
  req: AuthenticatedRequest,
  dataSourceId: string
): boolean {
  if (!req.user?.role?.permissions) {
    return false;
  }

  const permission = req.user.role.permissions.find(
    (p) => p.dataSourceId === dataSourceId
  );

  return permission?.hasAccess === true;
}

export function getAccessibleColumns(
  req: AuthenticatedRequest,
  dataSourceId: string,
  tableName: string
): string[] | null {
  if (!req.user?.role?.permissions) {
    return null;
  }

  const permission = req.user.role.permissions.find(
    (p) => p.dataSourceId === dataSourceId
  );

  if (!permission?.hasAccess) {
    return null;
  }

  const tablePermission = permission.tables.find(
    (t) => t.tableName === tableName
  );

  if (!tablePermission) {
    return null;
  }

  if (tablePermission.allColumns) {
    return []; 
  }

  return tablePermission.columns;
}

export function getRowFilters(
  req: AuthenticatedRequest,
  dataSourceId: string,
  tableName: string
): { allRows: boolean; filters: RowFilterCondition[] } {
  if (!req.user?.role?.permissions) {
    return { allRows: true, filters: [] };
  }

  if (req.user.role.isAdmin) {
    return { allRows: true, filters: [] };
  }

  const permission = req.user.role.permissions.find(
    (p) => p.dataSourceId === dataSourceId
  );

  if (!permission?.hasAccess) {
    return { allRows: true, filters: [] };
  }

  const tablePermission = permission.tables.find(
    (t) => t.tableName === tableName
  );

  if (!tablePermission) {
    return { allRows: true, filters: [] };
  }

  return {
    allRows: tablePermission.allRows !== false,
    filters: tablePermission.rowFilters || [],
  };
}

const VALID_OPERATORS = ["equals", "not_equals", "contains", "greater_than", "less_than", "in"] as const;
const VALID_LOGIC = ["AND", "OR"] as const;

function isValidColumnName(column: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column) && column.length <= 128;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function buildRowFilterWhereClause(filters: RowFilterCondition[], allowedColumns?: string[]): string {
  if (filters.length === 0) {
    return "";
  }

  const conditions = filters.map((filter, index) => {
    if (!isValidColumnName(filter.column)) {
      throw new Error(`Invalid column name: ${filter.column}`);
    }
    
    if (allowedColumns && !allowedColumns.includes(filter.column)) {
      throw new Error(`Column not permitted: ${filter.column}`);
    }
    
    if (!VALID_OPERATORS.includes(filter.operator as typeof VALID_OPERATORS[number])) {
      throw new Error(`Invalid operator: ${filter.operator}`);
    }
    
    const quotedColumn = quoteIdentifier(filter.column);
    const escapedValue = filter.value.replace(/'/g, "''");
    let condition: string;

    switch (filter.operator) {
      case "equals":
        condition = `${quotedColumn} = '${escapedValue}'`;
        break;
      case "not_equals":
        condition = `${quotedColumn} != '${escapedValue}'`;
        break;
      case "contains":
        condition = `${quotedColumn} LIKE '%${escapedValue}%'`;
        break;
      case "greater_than":
        condition = `${quotedColumn} > '${escapedValue}'`;
        break;
      case "less_than":
        condition = `${quotedColumn} < '${escapedValue}'`;
        break;
      case "in":
        const values = filter.value.split(",").map(v => `'${v.trim().replace(/'/g, "''")}'`).join(", ");
        condition = `${quotedColumn} IN (${values})`;
        break;
      default:
        throw new Error(`Unsupported operator: ${filter.operator}`);
    }

    if (index === 0) {
      return condition;
    }

    const logic = filter.logic || "AND";
    if (!VALID_LOGIC.includes(logic as typeof VALID_LOGIC[number])) {
      throw new Error(`Invalid logic operator: ${logic}`);
    }
    return `${logic} ${condition}`;
  });

  return conditions.join(" ");
}
