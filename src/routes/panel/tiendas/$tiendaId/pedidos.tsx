import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PedidosTable } from "@/components/PedidosTable";
import { TIENDAS_DEMO } from "@/lib/demo-data";

export const Route = createFileRoute("/panel/tiendas/$tiendaId/pedidos")({
  component: Pedidos,
});

function Pedidos() {
  const { tiendaId } = Route.useParams();
  const { data: tienda } = useQuery({
    queryKey: ["tienda-nombre", tiendaId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tiendas")
        .select("nombre")
        .eq("id", tiendaId)
        .maybeSingle();
      return data?.nombre ?? null;
    },
  });

  let h = 0;
  for (let i = 0; i < tiendaId.length; i++) h = (h * 31 + tiendaId.charCodeAt(i)) >>> 0;
  const tiendaDemo =
    (tienda && TIENDAS_DEMO.find((t) => t.toLowerCase() === tienda.toLowerCase())) ||
    TIENDAS_DEMO[h % TIENDAS_DEMO.length];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Pedidos · {tienda ?? tiendaDemo}
        </h1>
        <p className="text-sm text-muted-foreground">
          Pedidos sincronizados desde WooCommerce.
        </p>
      </div>
      <PedidosTable tienda={tiendaDemo} />
    </div>
  );
}