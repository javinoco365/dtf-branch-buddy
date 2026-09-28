import { createFileRoute } from "@tanstack/react-router";
import { PantallaCobrosPendientes } from "@/components/cobros/PantallaCobrosPendientes";

export const Route = createFileRoute("/panel/cobros")({
  head: () => ({ meta: [{ title: "Cobros pendientes · DTF Culture" }] }),
  component: CobrosGlobal,
});

function CobrosGlobal() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cobros pendientes</h1>
        <p className="text-sm text-muted-foreground">
          Lo que queda por cobrar de los pedidos de todas las tiendas y del textil, y las facturas
          sin cobrar.
        </p>
      </div>
      <PantallaCobrosPendientes />
    </div>
  );
}
