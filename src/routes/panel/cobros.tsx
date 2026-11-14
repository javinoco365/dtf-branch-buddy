import { createFileRoute } from "@tanstack/react-router";
import { PantallaCobrosPendientes } from "@/components/cobros/PantallaCobrosPendientes";
import { CabeceraPantalla } from "@/components/CabeceraPantalla";

export const Route = createFileRoute("/panel/cobros")({
  head: () => ({ meta: [{ title: "Cobros pendientes · DTF Culture" }] }),
  component: CobrosGlobal,
});

function CobrosGlobal() {
  return (
    <div className="space-y-6">
      <CabeceraPantalla subtitulo="Lo que queda por cobrar de los pedidos de todas las tiendas y del textil, y las facturas sin cobrar." />
      <PantallaCobrosPendientes />
    </div>
  );
}
