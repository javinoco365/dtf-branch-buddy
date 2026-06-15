import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PedidosTable } from "@/components/PedidosTable";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Pedidos · {tienda ?? "Tienda"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Pedidos sincronizados con WooCommerce y manuales.
        </p>
      </div>
      <PedidosTable tiendaId={tiendaId} />
    </div>
  );
}