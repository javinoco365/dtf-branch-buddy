import { type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ChevronRight, LogOut } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MARCA_DESCRIPCION, MARCA_NOMBRE } from "@/components/Marca";
import { BotonTema } from "@/components/BotonTema";
import { MedidorRendimiento } from "@/components/MedidorRendimiento";
import { usePermisos } from "@/hooks/use-permisos";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { pantallaActual } from "@/dominio/navegacion";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card px-4 sticky top-0 z-30">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="shrink-0" />
              <DondeEstoy />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm text-muted-foreground hidden lg:inline">{user?.email}</span>
              <BotonTema />
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/auth" });
                }}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Salir
              </Button>
            </div>
          </header>
          <AvisoSoloLectura />
          <main className="flex-1 p-4 md:p-6 max-w-full overflow-x-hidden">{children}</main>
        </div>
      </div>
      <MedidorRendimiento />
    </SidebarProvider>
  );
}

/**
 * Dónde está el usuario: «Dinero › Lo cobrado», «Tienda Uno › Facturas». En el
 * móvil, solo el nombre de la pantalla: el título de la página se va al
 * desplazar y la cabecera se queda.
 */
function DondeEstoy() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const idTienda = pathname.match(/^\/panel\/tiendas\/([^/]+)/)?.[1];
  const { data: tiendas } = useTiendasMenu();
  const nombreTienda = idTienda ? tiendas?.find((t) => t.id === idTienda)?.nombre : null;
  const pantalla = pantallaActual(pathname, nombreTienda);

  if (!pantalla) {
    return (
      <span className="hidden truncate text-sm text-muted-foreground md:inline">
        {MARCA_NOMBRE} · {MARCA_DESCRIPCION}
      </span>
    );
  }
  return (
    <nav aria-label="Estás en" className="flex min-w-0 items-center gap-1.5 text-sm">
      {pantalla.seccion && (
        <>
          <span className="hidden truncate text-muted-foreground md:inline">
            {pantalla.seccion}
          </span>
          <ChevronRight
            aria-hidden
            className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground md:inline"
          />
        </>
      )}
      <span className="truncate font-semibold md:font-medium" aria-current="page">
        {pantalla.titulo}
        {/* En el móvil, de qué tienda: «Facturas · Tienda Uno». */}
        {idTienda && pantalla.seccion && (
          <span className="font-normal text-muted-foreground md:hidden"> · {pantalla.seccion}</span>
        )}
      </span>
    </nav>
  );
}

/** Para un visor (o un usuario sin nivel): que sepa por qué no puede cambiar nada. */
function AvisoSoloLectura() {
  const { escribir, nivel, cargando } = usePermisos();
  if (cargando || escribir) return null;
  return (
    <div className="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
      {nivel === "visor"
        ? "Tienes acceso de solo lectura: puedes ver todo, pero no crear, cambiar ni borrar."
        : "Tu usuario no tiene nivel de acceso o está desactivado: no puedes cambiar datos. Habla con un administrador."}
    </div>
  );
}
