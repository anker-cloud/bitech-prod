import type { Request, Response, NextFunction, ParamsDictionary } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { storage } from "../storage";
import type { User, Role } from "@shared/schema";

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

function isDemoToken(token: string): boolean {
  return token.startsWith("demo.");
}

function parseDemoToken(token: string): { email: string; sub: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "demo") {
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    return { email: payload.email, sub: payload.sub };
  } catch {
    return null;
  }
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

    let email: string;

    if (isDemoToken(token)) {
      const demoPayload = parseDemoToken(token);
      if (!demoPayload) {
        return res.status(401).json({ message: "Invalid demo token" });
      }
      email = demoPayload.email;
    } else {
      try {
        const payload = await getVerifier().verify(token);
        email = payload.username as string;
      } catch (verifyError) {
        console.error("Token verification failed:", verifyError);
        return res.status(401).json({ message: "Invalid or expired token" });
      }
    }

    const user = await storage.getUserByEmail(email);
    
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
