import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
// Normal y no con lazy(): la ruta ya va en su propio trozo, y con lazy la
// tabla empezaba a pedir los pedidos un viaje más tarde.
import { PedidosTable } from "@/components/PedidosTable";
import { PedidosErrorBoundary } from "@/components/pedidos/PedidosErrorBoundary";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";

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
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <CabeceraPantalla
        tienda={tienda?.nombre}
        subtitulo="Pedidos sincronizados con WooCommerce y manuales."
      />
      <PedidosErrorBoundary>
        <PedidosTable tiendaId={tiendaId} />
      </PedidosErrorBoundary>
    </div>
  );
}
