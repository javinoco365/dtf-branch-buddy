import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LayoutDashboard,
  Store,
  Users,
  ShoppingCart,
  FileText,
  Settings,
  Printer,
  Building2,
  Receipt,
  Wallet,
  CalendarClock,
  ChevronRight,
  Plus,
  List,
  Shirt,
  Boxes,
  FileSpreadsheet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, user } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();

  const { data: tiendas = [] } = useQuery({
    queryKey: ["tiendas-sidebar", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tiendas")
        .select("id, nombre, color")
        .order("nombre");
      if (error) throw error;
      return data ?? [];
    },
  });

  const currentTiendaId = pathname.match(/^\/panel\/tiendas\/([^/]+)/)?.[1];
  const selectedValue =
    currentTiendaId && tiendas.some((t) => t.id === currentTiendaId) ? currentTiendaId : "";

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="px-3 py-4 flex items-center gap-2 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-sm">
            <Printer className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-bold text-sm truncate text-sidebar-foreground tracking-wide">
                CRM DTF
              </div>
              <div className="text-[11px] text-sidebar-foreground/60 truncate">
                Gestión multi-tienda
              </div>
            </div>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-[10px] font-semibold text-sidebar-foreground/50">
            Global / Consolidado
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/panel"}>
                  <Link to="/panel">
                    <LayoutDashboard />
                    <span>Dashboard Global</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/panel/facturacion-global")}
                >
                  <Link to="/panel/facturacion-global">
                    <Receipt />
                    <span>Facturación Consolidada</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/panel/pedidos"}>
                  <Link to="/panel/pedidos">
                    <ShoppingCart />
                    <span>Pedidos Consolidados</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/panel/cobros"}>
                  <Link to="/panel/cobros">
                    <Wallet />
                    <span>Cobros Pendientes</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/panel/proyectos"}>
                  <Link to="/panel/proyectos">
                    <CalendarClock />
                    <span>Próximos Proyectos</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-[10px] font-semibold text-sidebar-foreground/50">
            Tiendas
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {!collapsed && (
              <div className="px-2 pb-2">
                <Select
                  value={selectedValue}
                  onValueChange={(v) => {
                    if (v === "__new__") {
                      navigate({ to: "/panel/tiendas", search: { nueva: 1 } as any });
                    } else if (v === "__manage__") {
                      navigate({ to: "/panel/tiendas" });
                    } else {
                      navigate({
                        to: "/panel/tiendas/$tiendaId",
                        params: { tiendaId: v },
                      });
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs bg-sidebar-accent/40 border-sidebar-border">
                    <SelectValue placeholder="Selecciona una tienda…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tiendas.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: t.color ?? "hsl(var(--primary))" }}
                          />
                          {t.nombre}
                        </span>
                      </SelectItem>
                    ))}
                    {tiendas.length > 0 && <SelectSeparator />}
                    {isAdmin && (
                      <SelectItem value="__new__">
                        <span className="flex items-center gap-2 text-primary">
                          <Plus className="h-3.5 w-3.5" />
                          Nueva tienda
                        </span>
                      </SelectItem>
                    )}
                    <SelectItem value="__manage__">
                      <span className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5" />
                        Gestionar tiendas
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <SidebarMenu>
              {tiendas.length === 0 && !collapsed && (
                <div className="px-3 py-2 text-xs text-sidebar-foreground/50">
                  {isAdmin ? "Crea tu primera tienda" : "Sin tiendas asignadas"}
                </div>
              )}
              {tiendas.map((t) => {
                const base = `/panel/tiendas/${t.id}`;
                const isOpen = pathname.startsWith(base);
                return (
                  <Collapsible key={t.id} defaultOpen={isOpen} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={isOpen}>
                          <Store style={{ color: t.color ?? undefined }} />
                          <span className="truncate">{t.nombre}</span>
                          <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <SubItem
                            to="/panel/tiendas/$tiendaId/pedidos"
                            tiendaId={t.id}
                            label="Pedidos"
                            icon={ShoppingCart}
                            pathname={pathname}
                          />
                          <SubItem
                            to="/panel/tiendas/$tiendaId/facturas"
                            tiendaId={t.id}
                            label="Facturas"
                            icon={FileText}
                            pathname={pathname}
                          />
                          <SubItem
                            to="/panel/tiendas/$tiendaId/facturacion"
                            tiendaId={t.id}
                            label="Facturación"
                            icon={Receipt}
                            pathname={pathname}
                          />
                          <SubItem
                            to="/panel/tiendas/$tiendaId/cobros"
                            tiendaId={t.id}
                            label="Cobros"
                            icon={Wallet}
                            pathname={pathname}
                          />
                          <SubItem
                            to="/panel/tiendas/$tiendaId/proyectos"
                            tiendaId={t.id}
                            label="Proyectos"
                            icon={CalendarClock}
                            pathname={pathname}
                          />
                          <SubItem
                            to="/panel/tiendas/$tiendaId/clientes"
                            tiendaId={t.id}
                            label="Clientes"
                            icon={Users}
                            pathname={pathname}
                          />
                          <SubItem
                            to="/panel/tiendas/$tiendaId/ajustes"
                            tiendaId={t.id}
                            label="Ajustes"
                            icon={Settings}
                            pathname={pathname}
                          />
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-[10px] font-semibold text-sidebar-foreground/50">
            Textil Personalizado
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible
                defaultOpen={pathname.startsWith("/panel/textil")}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton isActive={pathname.startsWith("/panel/textil")}>
                      <Shirt />
                      <span>Textil Personalizado</span>
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <TextilSub
                        to="/panel/textil"
                        label="Resumen"
                        icon={LayoutDashboard}
                        pathname={pathname}
                        exact
                      />
                      <TextilSub
                        to="/panel/textil/stock"
                        label="Stock"
                        icon={Boxes}
                        pathname={pathname}
                      />
                      <TextilSub
                        to="/panel/textil/pedidos"
                        label="Pedidos"
                        icon={ShoppingCart}
                        pathname={pathname}
                      />
                      <TextilSub
                        to="/panel/textil/presupuestos"
                        label="Presupuestos"
                        icon={FileSpreadsheet}
                        pathname={pathname}
                      />
                      <TextilSub
                        to="/panel/textil/facturas"
                        label="Facturas"
                        icon={FileText}
                        pathname={pathname}
                      />
                      <TextilSub
                        to="/panel/textil/clientes"
                        label="Clientes"
                        icon={Users}
                        pathname={pathname}
                      />
                      <TextilSub
                        to="/panel/textil/ajustes"
                        label="Ajustes"
                        icon={Settings}
                        pathname={pathname}
                      />
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-[10px] font-semibold text-sidebar-foreground/50">
            Sistema
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible
                defaultOpen={pathname.startsWith("/panel/tiendas")}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton isActive={pathname.startsWith("/panel/tiendas")}>
                      <Building2 />
                      <span>Gestión de Tiendas</span>
                      <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === "/panel/tiendas"}>
                          <Link to="/panel/tiendas">
                            <List className="h-4 w-4" />
                            <span>Listado</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {isAdmin && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <button
                              type="button"
                              onClick={() =>
                                navigate({ to: "/panel/tiendas", search: { nueva: 1 } as any })
                              }
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-primary"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Nueva tienda</span>
                            </button>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/panel/configuracion")}>
                  <Link to="/panel/configuracion">
                    <Settings />
                    <span>Ajustes</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/panel/usuarios"}>
                    <Link to="/panel/usuarios">
                      <Users />
                      <span>Usuarios</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-3 py-2 text-[10px] text-sidebar-foreground/40 tracking-wider">
            v1.0.0
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function SubItem({
  to,
  tiendaId,
  label,
  icon: Icon,
  pathname,
}: {
  to: string;
  tiendaId: string;
  label: string;
  icon: any;
  pathname: string;
}) {
  const resolved = to.replace("$tiendaId", tiendaId);
  const active = pathname === resolved;
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active}>
        <Link to={to as any} params={{ tiendaId } as any}>
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function TextilSub({
  to,
  label,
  icon: Icon,
  pathname,
  exact,
}: {
  to: string;
  label: string;
  icon: any;
  pathname: string;
  exact?: boolean;
}) {
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active}>
        <Link to={to as any}>
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
