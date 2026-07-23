import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export interface AuthUser {
  id: number;
  username: string;
  email?: string | null;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  register: (username: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => Promise<void>;
  checkUsername: (username: string) => Promise<boolean | "error">;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => ({ ok: false, message: "Not initialized" }),
  register: async () => ({ ok: false, message: "Not initialized" }),
  logout: async () => {},
  checkUsername: async () => "error" as const,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current user on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json() as Promise<AuthUser>;
      })
      .then((data) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        // Not authenticated — that's fine
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username, password }),
        });
        const text = await res.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text);
        } catch {
          return {
            ok: false,
            message: `Server returned an unexpected response (HTTP ${res.status}). Please try again.`,
          };
        }
        if (!res.ok) {
          return { ok: false, message: (data.message as string) || "Login failed" };
        }
        setUser(data as unknown as AuthUser);
        return { ok: true };
      } catch (err) {
        console.error("[Auth] Login error:", err);
        return {
          ok: false,
          message: "Connection error. Please check your internet and try again.",
        };
      }
    },
    [],
  );

  const register = useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username, password }),
        });
        const text = await res.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text);
        } catch {
          return {
            ok: false,
            message: `Server returned an unexpected response (HTTP ${res.status}). Please try again.`,
          };
        }
        if (!res.ok) {
          return { ok: false, message: (data.message as string) || "Registration failed" };
        }
        setUser(data as unknown as AuthUser);
        return { ok: true };
      } catch (err) {
        console.error("[Auth] Register error:", err);
        return {
          ok: false,
          message: "Connection error. Please check your internet and try again.",
        };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("[Auth] Logout request failed (session cleared locally):", err);
    }
    setUser(null);
  }, []);

  /**
   * Checks whether a username is available for registration.
   * Returns `true` (available), `false` (taken), or `"error"` (network / server issue).
   */
  const checkUsername = useCallback(
    async (username: string): Promise<boolean | "error"> => {
      try {
        const res = await fetch(
          `/api/auth/check-username?username=${encodeURIComponent(username)}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          console.error("[Auth] Username check failed:", res.status, res.statusText);
          return "error";
        }
        const text = await res.text();
        let data: { available?: boolean };
        try {
          data = JSON.parse(text);
        } catch {
          console.error("[Auth] Username check returned non-JSON response");
          return "error";
        }
        return data.available === true;
      } catch (err) {
        console.error("[Auth] Username check connection error:", err);
        return "error";
      }
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        login,
        register,
        logout,
        checkUsername,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export type { AuthContextValue };
