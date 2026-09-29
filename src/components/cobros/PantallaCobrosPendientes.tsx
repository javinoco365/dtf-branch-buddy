import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFiltrosUrl } from "@/lib/filtros-url";
import { CobrosPendientes } from "@/components/CobrosPendientes";
import { PedidosPendientes } from "@/components/cobros/PedidosPendientes";

/**
 * Cobros pendientes: lo que queda por cobrar de los pedidos (tiendas y
 * textil) y, aparte, las facturas emitidas sin cobrar. Los pedidos van
 * primero porque es donde vive el día a día; las facturas son solo de tiendas.
 */
export function PantallaCobrosPendientes({ tiendaId }: { tiendaId?: string }) {
  // La pestaña también va en la dirección: al recargar se vuelve a la misma.
  const { valores, cambiar } = useFiltrosUrl({ vista: "pedidos" });
  return (
    <Tabs
      value={valores.vista === "facturas" ? "facturas" : "pedidos"}
      onValueChange={(vista) => cambiar({ vista })}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
        <TabsTrigger value="facturas">Facturas</TabsTrigger>
      </TabsList>
      <TabsContent value="pedidos">
        <PedidosPendientes tiendaId={tiendaId} />
      </TabsContent>
      <TabsContent value="facturas">
        <CobrosPendientes tiendaId={tiendaId} />
      </TabsContent>
    </Tabs>
  );
}
