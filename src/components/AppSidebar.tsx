import { Link, useRouterState } from "@tanstack/react-router";
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
import {
  LayoutDashboard,
  Store,
  Users,
  Package,
  ShoppingCart,
  FileText,
  Settings,
  Printer,
  Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, user } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

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
            Global
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/panel"}>
                  <Link to="/panel">
                    <LayoutDashboard />
                    <span>Panel global</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/panel/facturacion-global")}>
                  <Link to="/panel/facturacion-global">
                    <FileText />
                    <span>Facturación consolidada</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/panel/tiendas"}>
                    <Link to="/panel/tiendas">
                      <Building2 />
                      <span>Tiendas</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
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

        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider text-[10px] font-semibold text-sidebar-foreground/50">
            Tiendas
          </SidebarGroupLabel>
          <SidebarGroupContent>
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
                  <SidebarMenuItem key={t.id}>
                    <SidebarMenuButton asChild isActive={isOpen}>
                      <Link to="/panel/tiendas/$tiendaId" params={{ tiendaId: t.id }}>
                        <Store style={{ color: t.color ?? undefined }} />
                        <span className="truncate">{t.nombre}</span>
                      </Link>
                    </SidebarMenuButton>
                    {isOpen && !collapsed && (
                      <SidebarMenuSub>
                        <SubItem to="/panel/tiendas/$tiendaId/pedidos" tiendaId={t.id} label="Pedidos" icon={ShoppingCart} pathname={pathname} />
                        <SubItem to="/panel/tiendas/$tiendaId/facturas" tiendaId={t.id} label="Facturas" icon={FileText} pathname={pathname} />
                        <SubItem to="/panel/tiendas/$tiendaId/clientes" tiendaId={t.id} label="Clientes" icon={Users} pathname={pathname} />
                        <SubItem to="/panel/tiendas/$tiendaId/productos" tiendaId={t.id} label="Catálogo" icon={Package} pathname={pathname} />
                        <SubItem to="/panel/tiendas/$tiendaId/ajustes" tiendaId={t.id} label="Ajustes" icon={Settings} pathname={pathname} />
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
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