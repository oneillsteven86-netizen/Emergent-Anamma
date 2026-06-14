import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, fetchMyProfile } from "@/src/api";
import { supabase } from "@/src/supabase";

export type User = {
  id: string;
  name: string;
  email: string;
  role: "member" | "coach" | "admin";
  status: string;
  waiver_accepted: boolean;
  permissions?: Record<string, boolean>;
  phone?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  medical_notes?: string;
  bio?: string;
  photo?: string;
};

type AuthCtx = {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, phone?: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Hydrate from any persisted Supabase session at startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          const me = await fetchMyProfile();
          if (!cancelled) setUser((me as User) || null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    // Track future auth changes (token refresh, sign-out from elsewhere)
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setUser(null);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string, phone?: string) => {
      const res = await api<{ token: string; user: User }>("/auth/register", {
        method: "POST",
        body: { name, email, password, phone },
      });
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {
      // not authenticated — clear
    }
  }, []);

  return (
    <Ctx.Provider value={{ user, initializing, login, register, logout, refresh, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
