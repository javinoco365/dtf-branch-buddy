import { createFileRoute } from "@tanstack/react-router";
import { PedidosTable } from "@/components/PedidosTable";

export const Route = createFileRoute("/panel/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos Consolidados · CRM DTF" }] }),
  component: PedidosGlobal,
});

function PedidosGlobal() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos consolidados</h1>
        <p className="text-sm text-muted-foreground">
          Vista unificada de pedidos de todas las tiendas. Filtra y exporta.
        </p>
      </div>
      <PedidosTable />
    </div>
  );
}