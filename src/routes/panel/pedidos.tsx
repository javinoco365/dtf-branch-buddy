import { createFileRoute } from "@tanstack/react-router";
// Normal y no con lazy(): la ruta ya va en su propio trozo, y con lazy la
// tabla empezaba a pedir los pedidos un viaje más tarde.
import { PedidosTable } from "@/components/PedidosTable";
import { PedidosErrorBoundary } from "@/components/pedidos/PedidosErrorBoundary";

export const Route = createFileRoute("/panel/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos · DTF Culture" }] }),
  component: PedidosGlobal,
});

function PedidosGlobal() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
        <p className="text-sm text-muted-foreground">
          Vista unificada de pedidos de todas las tiendas. Filtra y exporta.
        </p>
      </div>
      <PedidosErrorBoundary>
        <PedidosTable />
      </PedidosErrorBoundary>
    </div>
  );
}
