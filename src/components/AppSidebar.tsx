import { useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Boxes,
  Building2,
  CalendarDays,
  ChevronRight,
  Coins,
  FilePen,
  FileText,
  FileUp,
  FolderArchive,
  ChartNoAxesCombined,
  Gauge,
  HandCoins,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PiggyBank,
  Plus,
  Receipt,
  ReceiptText,
  Settings,
  Shirt,
  Sparkles,
  ShoppingCart,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Marca } from "@/components/Marca";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { useAvisoAgenda } from "@/hooks/use-agenda";
import { useAvisoNovedades } from "@/hooks/use-novedades";
import {
  ENTRADA_GESTIONAR_TIENDAS,
  MENU_PRINCIPAL,
  MENU_SISTEMA,
  SUBMENU_TEXTIL,
  SUBMENU_TIENDA,
  entradaActiva,
  type ClaveIcono,
  type EntradaMenu,
} from "@/dominio/navegacion";

const ICONOS: Record<ClaveIcono, LucideIcon> = {
  inicio: LayoutDashboard,
  gerencia: Gauge,
  "cuenta-resultados": ChartNoAxesCombined,
  agenda: CalendarDays,
  pedidos: ShoppingCart,
  clientes: Users,
  productos: Package,
  cobros: Wallet,
  cobrado: HandCoins,
  compras: ReceiptText,
  banco: Landmark,
  caja: Coins,
  inversion: PiggyBank,
  archivo: FolderArchive,
  presupuestos: FilePen,
  facturas: FileText,
  facturacion: Receipt,
  ajustes: Settings,
  usuarios: Users,
  tiendas: Building2,
  stock: Boxes,
  "compras-textil": FileUp,
  novedades: Sparkles,
};

const ESTILO_GRUPO =
  "uppercase tracking-wider text-[10px] font-semibold text-sidebar-foreground/50";

/**
 * La barra lateral. Qué entradas hay y cómo se llaman sale de
 * `src/dominio/navegacion.ts`, el mismo mapa que pone el título en la
 * cabecera: así el nombre de cada pantalla es el mismo en los dos sitios.
 */
export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // En el cajón (móvil y tablet) el menú sale siempre entero, aunque en el
  // ordenador se hubiese plegado a iconos.
  const collapsed = state === "collapsed" && !isMobile;
  const { isAdmin } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  // En el cajón, al elegir una pantalla el menú se cierra solo: si no, se
  // queda tapando la pantalla que se acaba de abrir.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  // Con una tienda desplegada, su pantalla puede quedar por debajo del borde
  // del menú: se trae a la vista para que se vea dónde se está.
  useEffect(() => {
    const id = window.setTimeout(() => {
      // La más concreta: la pantalla de la tienda antes que la propia tienda.
      const activa =
        document.querySelector('[data-sidebar="menu-sub-button"][data-active="true"]') ??
        document.querySelector('[data-sidebar="menu-button"][data-active="true"]');
      activa?.scrollIntoView({ block: "nearest" });
    }, 250);
    return () => window.clearTimeout(id);
  }, [pathname]);
  const navigate = useNavigate();
  const { data: tiendas = [] } = useTiendasMenu();
  // Mis tareas de hoy, vencidas o nuevas (src/dominio/agenda.ts, resumenDe).
  const avisoAgenda = useAvisoAgenda();
  // Cambios del CRM que no se han visto en este dispositivo.
  const avisoNovedades = useAvisoNovedades();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="px-3 py-4 flex items-center gap-2 border-b border-sidebar-border text-sidebar-foreground">
          <Marca soloIcono={collapsed} />
        </div>

        {MENU_PRINCIPAL.map((seccion) => (
          <SidebarGroup key={seccion.titulo ?? "inicio"}>
            {seccion.titulo && (
              <SidebarGroupLabel className={ESTILO_GRUPO}>{seccion.titulo}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {seccion.entradas.map((e) => (
                  <Entrada
                    key={e.ruta}
                    entrada={e}
                    pathname={pathname}
                    aviso={e.ruta === "/panel/agenda" ? avisoAgenda : 0}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup>
          <SidebarGroupLabel className={ESTILO_GRUPO}>Tiendas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {tiendas.length === 0 && !collapsed && (
                <div className="px-3 py-2 text-xs text-sidebar-foreground/50">
                  {isAdmin ? "Crea tu primera tienda" : "No hay tiendas"}
                </div>
              )}
              {tiendas.map((t) => {
                const base = `/panel/tiendas/${t.id}`;
                const abierta = pathname === base || pathname.startsWith(`${base}/`);
                return (
                  <Collapsible key={t.id} defaultOpen={abierta} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={abierta} tooltip={t.nombre}>
                          <Store style={{ color: t.color ?? undefined }} />
                          <span className="truncate">{t.nombre}</span>
                          <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {SUBMENU_TIENDA.map((s) => {
                            const ruta = s.segmento ? `${base}/${s.segmento}` : base;
                            const Icono = ICONOS[s.icono];
                            return (
                              <SidebarMenuSubItem key={s.segmento || "resumen"}>
                                <SidebarMenuSubButton asChild isActive={pathname === ruta}>
                                  <Link to={ruta as never}>
                                    <Icono className="h-4 w-4" />
                                    <span>{s.etiqueta}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
              <Entrada entrada={ENTRADA_GESTIONAR_TIENDAS} pathname={pathname} />
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Nueva tienda"
                    onClick={() =>
                      navigate({ to: "/panel/tiendas", search: { nueva: 1 } as never })
                    }
                  >
                    <Plus />
                    <span>Nueva tienda</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className={ESTILO_GRUPO}>Textil</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible
                defaultOpen={pathname.startsWith("/panel/textil")}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      isActive={pathname.startsWith("/panel/textil")}
                      tooltip="Textil personalizado"
                    >
                      <Shirt />
                      <span>Textil personalizado</span>
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {SUBMENU_TEXTIL.map((e) => {
                        const Icono = ICONOS[e.icono];
                        return (
                          <SidebarMenuSubItem key={e.ruta}>
                            <SidebarMenuSubButton asChild isActive={entradaActiva(e, pathname)}>
                              <Link to={e.ruta as never}>
                                <Icono className="h-4 w-4" />
                                <span>{e.etiqueta}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className={ESTILO_GRUPO}>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MENU_SISTEMA.filter((e) => !e.soloAdmin || isAdmin).map((e) => (
                <Entrada
                  key={e.ruta}
                  entrada={e}
                  pathname={pathname}
                  aviso={e.ruta === "/panel/novedades" ? avisoNovedades : 0}
                  textoAviso={(n) => `${n} ${n === 1 ? "novedad sin ver" : "novedades sin ver"}`}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function Entrada({
  entrada,
  pathname,
  aviso = 0,
  textoAviso: describir = (n) =>
    `${n} ${n === 1 ? "tarea tuya" : "tareas tuyas"} de hoy, vencidas o nuevas`,
}: {
  entrada: EntradaMenu;
  pathname: string;
  /** Un número que pide atención (la Agenda, las Novedades). 0: nada. */
  aviso?: number;
  /** Qué significa el número, para el lector de pantalla y el tooltip. */
  textoAviso?: (n: number) => string;
}) {
  const Icono = ICONOS[entrada.icono];
  const textoAviso = aviso ? describir(aviso) : "";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={entradaActiva(entrada, pathname)}
        tooltip={aviso ? `${entrada.etiqueta} · ${textoAviso}` : entrada.etiqueta}
      >
        <Link to={entrada.ruta as never} className="relative">
          <Icono />
          <span>{entrada.etiqueta}</span>
          {aviso > 0 && (
            <>
              <span className="sr-only">, {textoAviso}</span>
              {/* Con el menú plegado no cabe el número: un punto sobre el icono. */}
              <span
                aria-hidden="true"
                className="absolute left-5 top-1 hidden h-2 w-2 rounded-full bg-sidebar-primary group-data-[collapsible=icon]:block"
              />
            </>
          )}
        </Link>
      </SidebarMenuButton>
      {aviso > 0 && (
        <SidebarMenuBadge
          aria-hidden="true"
          className="rounded-full bg-sidebar-primary font-bold text-sidebar-primary-foreground peer-hover/menu-button:text-sidebar-primary-foreground peer-data-[active=true]/menu-button:text-sidebar-primary-foreground"
        >
          {aviso}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}
