import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EtiquetaEstado } from "@/components/EtiquetaEstado";
import { EstadoVacio } from "@/components/EstadoVacio";
import { eur, fechaCorta } from "@/lib/format";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { Inbox } from "lucide-react";
import type { FilaPedidoHoy } from "@/dominio/hoy";

/**
 * La lista de pedidos de una tienda se lee por periodo: se abre en los días
 * de alrededor del pedido (uno antes y uno después, por si la hora lo mueve
 * de día) para que salga entero sin cargar años de pedidos.
 */
function alrededorDe(dia: string): { desde: string; hasta: string } {
  const base = Date.parse(`${dia.slice(0, 10)}T12:00:00Z`);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { desde: iso(base - 86_400_000), hasta: iso(base + 86_400_000) };
}

/**
 * Los pedidos que cuenta una cifra de «Hoy», en un panel. Cada uno lleva a su
 * lista (la de su tienda o la del textil) buscado por su número.
 */
export function PedidosDeHoy({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  pedidos,
  etiquetaImporte,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion: string;
  pedidos: readonly FilaPedidoHoy[];
  /** «Total» o «Pendiente». */
  etiquetaImporte: string;
}) {
  const { data: tiendas = [] } = useTiendasMenu();
  const nombreTienda = (id: string) =>
    id === TIENDA_TEXTIL.id ? "Textil" : (tiendas.find((t) => t.id === id)?.nombre ?? "Tienda");
  // Los más antiguos primero: son los que más esperan.
  const ordenados = [...pedidos].sort((a, b) => a.fecha.localeCompare(b.fecha));

  return (
    <Sheet open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle>
            {titulo} · {ordenados.length} {ordenados.length === 1 ? "pedido" : "pedidos"}
          </SheetTitle>
          <SheetDescription>{descripcion}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {ordenados.length === 0 ? (
            <div className="p-4">
              <EstadoVacio
                icono={Inbox}
                titulo="Ningún pedido"
                descripcion="Ahora mismo no hay ninguno en esta situación."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {ordenados.map((p) => {
                const textil = p.tiendaId === TIENDA_TEXTIL.id;
                const contenido = (
                  <>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-sm font-medium">{p.numero}</span>
                        <EtiquetaEstado
                          tipo={textil ? "pedido_textil" : "pedido"}
                          valor={p.estado}
                        />
                      </div>
                      <div className="truncate text-sm">{p.cliente || "Sin cliente"}</div>
                      <div className="text-xs text-muted-foreground">
                        {nombreTienda(p.tiendaId)} · {fechaCorta(p.fecha)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums">{eur(p.importe)}</div>
                      <div className="text-xs text-muted-foreground">{etiquetaImporte}</div>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </>
                );
                const clase =
                  "flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none";
                return (
                  <li key={`${p.tiendaId}-${p.id}`}>
                    {textil ? (
                      <Link
                        to="/panel/textil/pedidos"
                        search={{ q: p.numero }}
                        className={clase}
                        onClick={onCerrar}
                      >
                        {contenido}
                      </Link>
                    ) : (
                      <Link
                        to="/panel/tiendas/$tiendaId/pedidos"
                        params={{ tiendaId: p.tiendaId }}
                        search={{ q: p.numero, periodo: "libre", ...alrededorDe(p.fecha) }}
                        className={clase}
                        onClick={onCerrar}
                      >
                        {contenido}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
