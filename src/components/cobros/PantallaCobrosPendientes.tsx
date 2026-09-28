import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CobrosPendientes } from "@/components/CobrosPendientes";
import { PedidosPendientes } from "@/components/cobros/PedidosPendientes";

/**
 * Cobros pendientes: lo que queda por cobrar de los pedidos (tiendas y
 * textil) y, aparte, las facturas emitidas sin cobrar. Los pedidos van
 * primero porque es donde vive el día a día; las facturas son solo de tiendas.
 */
export function PantallaCobrosPendientes({ tiendaId }: { tiendaId?: string }) {
  return (
    <Tabs defaultValue="pedidos" className="space-y-4">
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
