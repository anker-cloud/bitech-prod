import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { AuthenticatedUser, Role } from "@shared/schema";

interface AuthContextType {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  canGenerateApiKeys: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setAuthUser: (user: AuthenticatedUser) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const validateSession = async () => {
      const storedUser = localStorage.getItem("auth_user");
      if (!storedUser) {
        setIsLoading(false);
        return;
      }

      try {
        const parsedUser = JSON.parse(storedUser);
        
        // Validate token with backend
        const response = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${parsedUser.accessToken}`,
          },
        });

        if (response.ok) {
          const validatedUser = await response.json();
          setUser({ ...validatedUser, accessToken: parsedUser.accessToken });
          localStorage.setItem("auth_user", JSON.stringify({ ...validatedUser, accessToken: parsedUser.accessToken }));
        } else {
          // Token invalid or user deleted - clear local storage
          localStorage.removeItem("auth_user");
          setUser(null);
        }
      } catch {
        localStorage.removeItem("auth_user");
        setUser(null);
      }
      setIsLoading(false);
    };

    validateSession();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Login failed");
    }

    const data = await response.json();
    setUser(data.user);
    localStorage.setItem("auth_user", JSON.stringify(data.user));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("auth_user");
  }, []);

  const setAuthUser = useCallback((newUser: AuthenticatedUser) => {
    setUser(newUser);
    localStorage.setItem("auth_user", JSON.stringify(newUser));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAdmin: user?.isAdmin ?? false,
        canGenerateApiKeys: user?.role?.canGenerateApiKeys ?? false,
        login,
        logout,
        setAuthUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
