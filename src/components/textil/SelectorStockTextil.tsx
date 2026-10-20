import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { numeroJusto } from "@/lib/format";
import {
  agruparPorProducto,
  buscarProductos,
  disponible,
  lineasDesdeStock,
  rejillaProducto,
  type GrupoProducto,
} from "@/dominio/stock-textil";
import type { LineaDocumentoTextil, VarianteCatalogo } from "@/dominio/tipos-textil";

/** Cuántos productos se enseñan como mucho en la lista de resultados. */
const MAX_RESULTADOS = 60;

type Comun = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Todo el catálogo: aquí solo se ofrecen las variantes activas y no repetidas. */
  variantes: readonly VarianteCatalogo[];
  /** El texto con el que se abre ya buscado (la descripción de una línea de factura). */
  textoInicial?: string;
};

type Props =
  | (Comun & {
      /** Presupuesto o pedido: una cantidad por celda. */
      modo: "cantidades";
      /** Lo que reserva el propio pedido que se edita (no se cuenta dos veces). */
      reservadoPropio?: ReadonlyMap<string, number>;
      /** Lo que ya piden las líneas del documento, por variante. */
      enDocumento?: ReadonlyMap<string, number>;
      /** En un pedido no deja añadir lo que falta; en un presupuesto solo avisa. */
      bloquearFaltante: boolean;
      onAnadir: (lineas: LineaDocumentoTextil[]) => void;
    })
  | (Comun & {
      /** Casado de una línea de compra: se pulsa la celda. */
      modo: "una";
      onElegir: (v: VarianteCatalogo) => void;
    });

/**
 * Elegir prendas del almacén: buscador por producto y rejilla color × talla con
 * el disponible (físico − reservado) de cada variante.
 *
 * Sirve para dos cosas: añadir líneas a un presupuesto o a un pedido (modo
 * «cantidades») y decir a qué variante corresponde una línea de una factura de
 * compra (modo «una»).
 */
export function SelectorStockTextil(props: Props) {
  const { open, onOpenChange, variantes, textoInicial, modo } = props;
  const [texto, setTexto] = useState(textoInicial ?? "");
  const [clave, setClave] = useState<string | null>(null);
  const [cantidades, setCantidades] = useState<Map<string, number>>(new Map());

  // Cada vez que se abre, empieza de cero con el texto que traiga.
  useEffect(() => {
    if (open) {
      setTexto(textoInicial ?? "");
      setClave(null);
      setCantidades(new Map());
    }
  }, [open, textoInicial]);

  const grupos = useMemo(() => agruparPorProducto(variantes), [variantes]);
  const resultados = useMemo(() => buscarProductos(grupos, texto), [grupos, texto]);
  const grupo: GrupoProducto | null = clave
    ? (grupos.find((g) => g.clave === clave) ?? null)
    : null;
  const reservadoPropio = props.modo === "cantidades" ? props.reservadoPropio : undefined;
  const rejilla = useMemo(
    () => (grupo ? rejillaProducto(grupo, reservadoPropio) : null),
    [grupo, reservadoPropio],
  );

  // Las elegidas, de todos los productos que se hayan abierto.
  const porId = useMemo(() => new Map(variantes.map((v) => [v.id, v])), [variantes]);
  const elegidas = [...cantidades.entries()].filter(([, c]) => c > 0);
  const faltaDe = (id: string, disponible: number) => {
    const pedido =
      (cantidades.get(id) ?? 0) +
      (props.modo === "cantidades" ? (props.enDocumento?.get(id) ?? 0) : 0);
    return Math.max(0, pedido - Math.max(0, disponible));
  };
  // Lo que falta en lo elegido, con el disponible de cada variante.
  const conFalta = elegidas.filter(([id]) => {
    const v = porId.get(id);
    if (!v) return false;
    return faltaDe(id, disponible(v, reservadoPropio?.get(id) ?? 0)) > 0;
  }).length;
  const bloqueado = props.modo === "cantidades" && props.bloquearFaltante && conFalta > 0;

  const anadir = () => {
    if (props.modo !== "cantidades") return;
    const lista = elegidas.map(([id]) => porId.get(id)).filter((v): v is VarianteCatalogo => !!v);
    props.onAnadir(lineasDesdeStock(lista, cantidades));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {modo === "una" ? "Elegir la variante del almacén" : "Elegir del stock"}
          </DialogTitle>
          <DialogDescription>
            {modo === "una"
              ? "Busca el producto y pulsa la celda de su color y talla."
              : "Busca el producto y escribe cuántas quieres de cada color y talla. El número grande es lo disponible: lo que hay menos lo reservado para otros pedidos."}
          </DialogDescription>
        </DialogHeader>

        {!grupo ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                placeholder="Marca, referencia, nombre, SKU, color o EAN…"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
            {grupos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No hay prendas activas en el almacén.
              </p>
            ) : resultados.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Ningún producto coincide con «{texto}».
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {resultados.slice(0, MAX_RESULTADOS).map((g) => (
                  <li key={g.clave}>
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => setClave(g.clave)}
                    >
                      <span className="min-w-0">
                        <span className="font-medium">
                          {[g.marca, g.referencia, g.nombre].filter(Boolean).join(" · ")}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {g.variantes.length} variante{g.variantes.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        Disponible{" "}
                        <span className="font-semibold text-foreground">
                          {numeroJusto(g.disponible)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {resultados.length > MAX_RESULTADOS && (
              <p className="text-xs text-muted-foreground">
                Se ven los {MAX_RESULTADOS} primeros de {resultados.length}: afina la búsqueda.
              </p>
            )}
          </div>
        ) : (
          rejilla && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setClave(null)}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Otro producto
                </Button>
                <span className="text-sm font-medium">
                  {[grupo.marca, grupo.referencia, grupo.nombre].filter(Boolean).join(" · ")}
                </span>
              </div>
              {/* La rejilla puede ser ancha: se desplaza dentro de su caja, no la página. */}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                        Color
                      </th>
                      {rejilla.tallas.map((t) => (
                        <th
                          key={t.clave}
                          className="px-2 py-2 text-center font-medium text-muted-foreground"
                        >
                          {t.etiqueta}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rejilla.colores.map((c, i) => (
                      <tr key={c.clave} className="border-b last:border-0">
                        <td className="px-2 py-2 font-medium whitespace-nowrap">{c.etiqueta}</td>
                        {rejilla.tallas.map((t, j) => {
                          const celda = rejilla.celdas[i][j];
                          if (!celda) {
                            return (
                              <td
                                key={t.clave}
                                className="px-2 py-2 text-center text-muted-foreground"
                              >
                                —
                              </td>
                            );
                          }
                          const id = celda.variante.id;
                          const falta = faltaDe(id, celda.disponible);
                          const detalle = `físico ${numeroJusto(celda.fisico)} · reservado ${numeroJusto(celda.reservado)}`;
                          if (props.modo === "una") {
                            return (
                              <td key={t.clave} className="p-1 text-center">
                                <button
                                  type="button"
                                  className="w-full min-w-[4.5rem] rounded-md border px-2 py-1.5 hover:border-primary hover:bg-primary/5"
                                  onClick={() => {
                                    props.onElegir(celda.variante);
                                    onOpenChange(false);
                                  }}
                                >
                                  <span className="block text-base font-semibold tabular-nums">
                                    {numeroJusto(celda.disponible)}
                                  </span>
                                  <span className="block text-[10px] text-muted-foreground">
                                    {detalle}
                                  </span>
                                </button>
                              </td>
                            );
                          }
                          return (
                            <td key={t.clave} className="p-1 text-center align-top">
                              <div
                                className={`min-w-[5rem] rounded-md border px-1.5 py-1 ${
                                  falta > 0 ? "border-destructive/60 bg-destructive/10" : ""
                                }`}
                              >
                                <span className="block text-base font-semibold tabular-nums">
                                  {numeroJusto(celda.disponible)}
                                </span>
                                <span className="block text-[10px] text-muted-foreground">
                                  {detalle}
                                </span>
                                <Input
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  aria-label={`Cantidad ${c.etiqueta} ${t.etiqueta}`}
                                  className="mt-1 h-8 px-1 text-center"
                                  value={cantidades.get(id) ?? ""}
                                  onChange={(e) => {
                                    const n = Math.max(0, Number(e.target.value) || 0);
                                    setCantidades((m) => {
                                      const s = new Map(m);
                                      if (n > 0) s.set(id, n);
                                      else s.delete(id);
                                      return s;
                                    });
                                  }}
                                />
                                {falta > 0 && (
                                  <span className="mt-0.5 block text-[11px] font-medium text-destructive">
                                    Faltan {numeroJusto(falta)}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        {props.modo === "cantidades" && (
          <DialogFooter className="items-center gap-2">
            {conFalta > 0 && (
              <span
                className={`text-sm mr-auto ${bloqueado ? "text-destructive" : "text-amber-700"}`}
              >
                {bloqueado
                  ? "Un pedido no puede llevar más de lo disponible: baja las cantidades en rojo."
                  : "Hay cantidades por encima de lo disponible: el presupuesto avisa, pero se puede guardar."}
              </span>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button disabled={elegidas.length === 0 || bloqueado} onClick={anadir}>
              Añadir {elegidas.length} línea{elegidas.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
