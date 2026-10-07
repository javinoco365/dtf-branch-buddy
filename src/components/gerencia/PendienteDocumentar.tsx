import { FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eur } from "@/lib/format";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import type { PendienteDocumentar as Pendiente } from "@/dominio/grupos";
import { VerDetalle } from "./comun";

/**
 * Un botón pequeño en la esquina: cuántos pedidos del periodo no tienen
 * factura ni ticket. Al abrirlo, por tienda, con el enlace a su pantalla de
 * facturas, donde se emiten los tickets pendientes en bloque.
 */
export function PendienteDocumentar({
  pendiente,
  tiendas,
}: {
  pendiente: Pendiente | null;
  tiendas: readonly { id: string; nombre: string }[];
}) {
  if (!pendiente || pendiente.pedidos === 0) return null;
  const nombre = new Map([...tiendas, TIENDA_TEXTIL].map((t) => [t.id, t.nombre]));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-status-pendiente"
          title="Pedidos del periodo sin factura ni ticket"
        >
          <FileWarning className="h-3.5 w-3.5" />
          {pendiente.pedidos} sin documento
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        <p className="font-medium">
          {pendiente.pedidos} {pendiente.pedidos === 1 ? "pedido" : "pedidos"} sin factura ni ticket
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {eur(pendiente.vendido)} del periodo. Toda venta tiene que llevar su documento: al
          emitirlo, pasa a lo documentado (A).
        </p>
        <ul className="mt-3 space-y-1.5">
          {pendiente.porTienda.map((t) => (
            <li key={t.tienda_id} className="flex items-center justify-between gap-2">
              <span>
                {nombre.get(t.tienda_id) ?? "Tienda"}{" "}
                <span className="text-muted-foreground">· {t.pedidos}</span>
              </span>
              <VerDetalle
                destino={{
                  to:
                    t.tienda_id === TIENDA_TEXTIL.id
                      ? "/panel/textil/facturas"
                      : `/panel/tiendas/${t.tienda_id}/facturas`,
                  search: {},
                }}
                texto="Emitir"
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
