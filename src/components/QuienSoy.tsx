// «¿Quién eres?»: la pantalla que se pone delante del CRM cuando una cuenta la
// usan varios socios, y el selector de persona de la cabecera.
//
// Las reglas están en src/dominio/quien-soy.ts. Aquí solo se lee la lista de
// socios de la cuenta (misPersonas) y se guarda la persona en el DISPOSITIVO,
// en una sola clave (crm:quien-soy), no por cuenta: el dispositivo que ya
// eligió entra directo aunque se salga y se vuelva a entrar.
// No es una contraseña: no limita lo que se ve.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronRight, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { misPersonas } from "@/lib/quien-soy.functions";
import { estadoQuienSoy, iniciales } from "@/dominio/quien-soy";
import { QuienSoyContexto, useQuienSoy, type QuienSoy } from "@/hooks/use-quien-soy";
import { MARCA_NOMBRE } from "@/components/Marca";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const CLAVE = "crm:quien-soy";

// El dispositivo puede no dejar guardar (ventana privada, datos bloqueados): en
// ese caso se pregunta en cada carga, que es lo seguro.
function leerGuardada(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}
function guardar(id: string) {
  try {
    localStorage.setItem(CLAVE, id);
  } catch {
    // Sin almacenamiento, la elección dura hasta recargar.
  }
}

export function QuienSoyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const cuenta = user?.id ?? null;
  const leerPersonas = useServerFn(misPersonas);
  const { data } = useQuery({
    queryKey: ["quien-soy", cuenta],
    queryFn: () => leerPersonas(),
    enabled: !!cuenta,
    staleTime: 5 * 60_000,
  });

  const [guardada, setGuardada] = useState<string | null>(() => leerGuardada());

  // Otra pestaña ha elegido: esta se entera sin recargar.
  useEffect(() => {
    const alCambiar = (e: StorageEvent) => {
      if (e.key === CLAVE) setGuardada(leerGuardada());
    };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, []);

  const estado = useMemo(() => estadoQuienSoy(data?.personas ?? [], guardada), [data, guardada]);

  const elegir = useCallback((id: string) => {
    guardar(id);
    setGuardada(id);
  }, []);

  const value = useMemo<QuienSoy>(
    () => ({ estado, persona: estado.tipo === "identificado" ? estado.persona : null, elegir }),
    [estado, elegir],
  );
  return <QuienSoyContexto.Provider value={value}>{children}</QuienSoyContexto.Provider>;
}

function Avatar({
  nombre,
  activo,
  grande,
}: {
  nombre: string;
  activo?: boolean;
  grande?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-bold tracking-wide",
        grande ? "h-9 w-9 text-[13px]" : "h-6 w-6 text-[11px]",
        activo ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-foreground",
      )}
    >
      {iniciales(nombre)}
    </span>
  );
}

/**
 * Delante de todo el CRM mientras no se ha elegido. Lo pinta AppShell, que deja
 * el resto inerte (ni ratón ni teclado llegan detrás).
 */
export function PantallaQuienEres() {
  const { estado, elegir } = useQuienSoy();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  if (estado.tipo !== "elegir") return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quien-eres-titulo"
      className="fixed inset-0 z-[100] grid place-items-center overflow-auto bg-sidebar/95 p-4"
    >
      <div className="flex w-full max-w-[460px] flex-col gap-3.5 rounded-2xl bg-card px-6 pb-5 pt-7 text-card-foreground shadow-2xl">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {MARCA_NOMBRE} · CRM
        </span>
        <h1 id="quien-eres-titulo" className="text-[26px] font-bold leading-tight">
          ¿Quién eres?
        </h1>
        <p className="text-secondary-foreground">
          Esta cuenta la usáis varias personas. Elige tu nombre para entrar: así la Agenda sabe qué
          tareas son tuyas y quién crea cada una.
        </p>
        <div className="mt-1 flex flex-col gap-2">
          {estado.personas.map((p, i) => {
            return (
              <button
                key={p.id}
                type="button"
                autoFocus={i === 0}
                onClick={() => elegir(p.id)}
                className="flex min-h-[60px] items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left text-[15px] font-semibold transition-colors hover:border-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Avatar nombre={p.nombre} grande />
                <span className="min-w-0 flex-1">{p.nombre}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Este dispositivo lo recordará y no volverá a preguntar, aunque salgas y vuelvas a entrar.
          Para cambiar de persona, pulsa tu nombre arriba a la derecha.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={async () => {
            await signOut();
            navigate({ to: "/auth" });
          }}
        >
          <LogOut className="h-4 w-4" /> Salir
        </Button>
      </div>
    </div>
  );
}

/**
 * En la cabecera: quién eres. Con varios socios en la cuenta, un menú para
 * cambiar; con uno, el nombre fijo; sin socios, el correo, como antes.
 */
export function SelectorPersona({ email }: { email?: string | null }) {
  const { estado, elegir } = useQuienSoy();

  if (estado.tipo !== "identificado") {
    return email ? (
      <span className="hidden text-sm text-muted-foreground lg:inline">{email}</span>
    ) : null;
  }

  const { persona } = estado;
  const chip = (
    <>
      <Avatar nombre={persona.nombre} activo />
      <span className="hidden max-w-[180px] truncate sm:inline">{persona.nombre}</span>
    </>
  );

  if (!estado.puedeCambiar) {
    return (
      <span
        className="flex items-center gap-2 rounded-full border px-1 py-1 text-sm font-semibold sm:pr-3"
        title={`Esta cuenta es solo de ${persona.nombre}`}
      >
        {chip}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2 text-sm font-semibold transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={`Eres ${persona.nombre}. Cambiar de persona`}
        >
          {chip}
          <span className="hidden font-normal text-muted-foreground md:inline">· cambiar</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Esta cuenta la compartís. ¿Quién la está usando?
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {estado.personas.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => {
              if (p.id === persona.id) return;
              elegir(p.id);
              toast.success(`Ahora eres ${p.nombre}`);
            }}
            className="gap-2.5"
          >
            <Avatar nombre={p.nombre} activo={p.id === persona.id} />
            <span className="flex-1">{p.nombre}</span>
            {p.id === persona.id && (
              <Check className="h-4 w-4 text-status-completado" aria-label="Eres tú" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
