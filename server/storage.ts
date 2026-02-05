import { 
  users, roles, queryHistory, apiKeys,
  type User, type InsertUser,
  type Role, type InsertRole,
  type QueryHistory, type InsertQueryHistory,
  type ApiKey, type InsertApiKey
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByCognitoId(cognitoUserId: string): Promise<User | undefined>;
  getAllUsers(): Promise<(User & { role?: Role })[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getRole(id: string): Promise<Role | undefined>;
  getRoleByName(name: string): Promise<Role | undefined>;
  getAllRoles(): Promise<Role[]>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, role: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<void>;
  getRoleUserCounts(): Promise<Record<string, number>>;

  createQueryHistory(query: InsertQueryHistory): Promise<QueryHistory>;
  getUserQueryHistory(userId: string): Promise<QueryHistory[]>;

  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  getApiKeysByUserId(userId: string): Promise<ApiKey[]>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined>;
  revokeApiKey(id: string, userId: string): Promise<void>;
  deleteApiKey(id: string, userId: string): Promise<void>;
  deleteApiKeysByUserId(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByCognitoId(cognitoUserId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.cognitoUserId, cognitoUserId));
    return user || undefined;
  }

  async getAllUsers(): Promise<(User & { role?: Role })[]> {
    const allUsers = await db.select().from(users);
    const allRoles = await db.select().from(roles);
    
    return allUsers.map(user => ({
      ...user,
      role: user.roleId ? allRoles.find(r => r.id === user.roleId) : undefined
    }));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role || undefined;
  }

  async getRoleByName(name: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.name, name));
    return role || undefined;
  }

  async getAllRoles(): Promise<Role[]> {
    return db.select().from(roles);
  }

  async createRole(insertRole: InsertRole): Promise<Role> {
    const [role] = await db.insert(roles).values(insertRole as any).returning();
    return role;
  }

  async updateRole(id: string, updates: Partial<InsertRole>): Promise<Role | undefined> {
    const [role] = await db
      .update(roles)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(roles.id, id))
      .returning();
    return role || undefined;
  }

  async deleteRole(id: string): Promise<void> {
    await db.delete(roles).where(eq(roles.id, id));
  }

  async getRoleUserCounts(): Promise<Record<string, number>> {
    const result = await db
      .select({
        roleId: users.roleId,
        count: sql<number>`count(*)::int`
      })
      .from(users)
      .groupBy(users.roleId);
    
    const counts: Record<string, number> = {};
    result.forEach(r => {
      if (r.roleId) {
        counts[r.roleId] = r.count;
      }
    });
    return counts;
  }

  async createQueryHistory(insertQuery: InsertQueryHistory): Promise<QueryHistory> {
    const [query] = await db.insert(queryHistory).values(insertQuery).returning();
    return query;
  }

  async getUserQueryHistory(userId: string): Promise<QueryHistory[]> {
    return db.select().from(queryHistory).where(eq(queryHistory.userId, userId));
  }

  async createApiKey(insertApiKey: InsertApiKey): Promise<ApiKey> {
    const [apiKey] = await db.insert(apiKeys).values(insertApiKey).returning();
    return apiKey;
  }

  async getApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db.select().from(apiKeys).where(
      and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isRevoked, false))
    );
    return apiKey || undefined;
  }

  async revokeApiKey(id: string, userId: string): Promise<void> {
    const result = await db.update(apiKeys)
      .set({ isRevoked: true })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning();
    
    if (result.length === 0) {
      throw new Error("API key not found or does not belong to this user");
    }
  }

  async deleteApiKey(id: string, userId: string): Promise<void> {
    const result = await db.delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning();
    
    if (result.length === 0) {
      throw new Error("API key not found or does not belong to this user");
    }
  }

  async deleteApiKeysByUserId(userId: string): Promise<void> {
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
  }
}

export const storage = new DatabaseStorage();
