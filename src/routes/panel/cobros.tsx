import { createFileRoute } from "@tanstack/react-router";
import { CobrosPendientes } from "@/components/CobrosPendientes";

export const Route = createFileRoute("/panel/cobros")({
  head: () => ({ meta: [{ title: "Cobros pendientes · CRM DTF" }] }),
  component: CobrosGlobal,
});

function CobrosGlobal() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cobros pendientes</h1>
        <p className="text-sm text-muted-foreground">
          Facturas pendientes de cobro de todas las tiendas.
        </p>
      </div>
      <CobrosPendientes />
    </div>
  );
}