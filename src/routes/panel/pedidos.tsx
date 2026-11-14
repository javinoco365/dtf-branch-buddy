import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
// Normal y no con lazy(): la ruta ya va en su propio trozo, y con lazy la
// tabla empezaba a pedir los pedidos un viaje más tarde.
import { PedidosTable } from "@/components/PedidosTable";
import { PedidosErrorBoundary } from "@/components/pedidos/PedidosErrorBoundary";
import { SiPuede } from "@/components/SiPuede";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";

// Con lazy(), como en PedidosTable: el mismo módulo importado de las dos
// maneras rompe el servidor de producción (ver importaciones-mixtas.test.ts).
const PedidoFormDialog = lazy(() =>
  import("@/components/PedidoFormDialog").then((m) => ({ default: m.PedidoFormDialog })),
);

export const Route = createFileRoute("/panel/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos · DTF Culture" }] }),
  component: PedidosGlobal,
});

function PedidosGlobal() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-sm text-muted-foreground">Todos los pedidos de todas las tiendas.</p>
        </div>
        <SiPuede accion="escribir">
          <NuevoPedidoConTienda />
        </SiPuede>
      </div>
      <PedidosErrorBoundary>
        <PedidosTable />
      </PedidosErrorBoundary>
    </div>
  );
}

/**
 * Un pedido es siempre de una tienda. Desde la lista de todas, primero se
 * elige cuál (si solo hay una, va directa) y después sale el formulario de
 * siempre.
 */
function NuevoPedidoConTienda() {
  const queryClient = useQueryClient();
  const { data: tiendas = [] } = useTiendasMenu();
  const [eligiendo, setEligiendo] = useState(false);
  const [elegida, setElegida] = useState("");
  const [tiendaId, setTiendaId] = useState<string | null>(null);

  if (tiendas.length === 0) return null;

  function empezar() {
    if (tiendas.length === 1) setTiendaId(tiendas[0].id);
    else {
      setElegida("");
      setEligiendo(true);
    }
  }

  return (
    <>
      <Button onClick={empezar}>
        <Plus className="h-4 w-4 mr-2" /> Nuevo pedido
      </Button>

      <Dialog open={eligiendo} onOpenChange={setEligiendo}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo pedido</DialogTitle>
            <DialogDescription>¿De qué tienda es el pedido?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tienda-nuevo-pedido">Tienda</Label>
            <Select value={elegida} onValueChange={setElegida}>
              <SelectTrigger id="tienda-nuevo-pedido">
                <SelectValue placeholder="Elige la tienda" />
              </SelectTrigger>
              <SelectContent>
                {tiendas.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEligiendo(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!elegida}
              onClick={() => {
                setEligiendo(false);
                setTiendaId(elegida);
              }}
            >
              Seguir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        {tiendaId && (
          <PedidoFormDialog
            open={!!tiendaId}
            onOpenChange={(o) => !o && setTiendaId(null)}
            tiendaId={tiendaId}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["pedidos"] })}
          />
        )}
      </Suspense>
    </>
  );
}
