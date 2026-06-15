import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/panel/tiendas/$tiendaId")({
  component: TiendaLayout,
});

function TiendaLayout() {
  const { tiendaId } = Route.useParams();
  const { data: tienda } = useQuery({
    queryKey: ["tienda", tiendaId],
    queryFn: async () => {
      const { data } = await supabase.from("tiendas").select("*").eq("id", tiendaId).maybeSingle();
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold">{tienda?.nombre ?? "Tienda"}</h1>
        <p className="text-sm text-muted-foreground">{tienda?.woo_url}</p>
      </div>
      <Outlet />
    </div>
  );
}