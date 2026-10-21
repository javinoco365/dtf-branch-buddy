import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { comprobarAdminActual } from "@/lib/admin.functions";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // La comprobación de administrador se hace una sola vez por usuario. Antes
  // salía dos veces al entrar (por INITIAL_SESSION y por getSession) y otra en
  // cada TOKEN_REFRESHED, cada una con su server function. Se guarda la
  // promesa, no solo el id, para que quien llegue segundo espere a la misma
  // respuesta en vez de lanzar otra. Si falla, se olvida y el siguiente evento
  // de sesión la repite (como hasta ahora).
  const comprobacion = useRef<{ userId: string; promesa: Promise<void> } | null>(null);

  const refreshAdmin = (s: Session | null): Promise<void> => {
    const userId = s?.user?.id;
    if (!userId) {
      comprobacion.current = null;
      setIsAdmin(false);
      return Promise.resolve();
    }
    if (comprobacion.current?.userId === userId) return comprobacion.current.promesa;

    const actual = {
      userId,
      promesa: comprobarAdminActual()
        .then((result) => {
          if (comprobacion.current === actual) setIsAdmin(result.isAdmin);
        })
        .catch(() => {
          if (comprobacion.current === actual) {
            comprobacion.current = null;
            setIsAdmin(false);
          }
        }),
    };
    comprobacion.current = actual;
    return actual.promesa;
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

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      isAdmin,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, isAdmin, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
