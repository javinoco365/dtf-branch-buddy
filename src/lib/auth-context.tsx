import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { comprobarAdminActual } from "@/lib/admin.functions";
import type { Nivel } from "@/dominio/permisos";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  /** admin, editor o visor; null sin nivel, desactivado o sin sesión. */
  nivel: Nivel | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  isAdmin: false,
  nivel: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [nivel, setNivel] = useState<Nivel | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAdmin = async (s: Session | null) => {
    if (!s?.user) {
      setIsAdmin(false);
      setNivel(null);
      return;
    }

    try {
      const result = await comprobarAdminActual();
      setIsAdmin(result.isAdmin);
      setNivel(result.nivel);
    } catch {
      // Sin saber el nivel, la interfaz no ofrece escribir. La base decide
      // igual; esto solo evita enseñar botones que luego fallarían.
      setIsAdmin(false);
      setNivel(null);
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setTimeout(() => refreshAdmin(s), 0);
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await refreshAdmin(data.session);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        isAdmin,
        nivel,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
