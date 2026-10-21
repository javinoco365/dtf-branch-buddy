import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { unirProductosTextil } from "@/lib/escaner-textil.functions";
import { mensajeDeError } from "@/lib/errores";
import type { PropuestaUnion } from "@/dominio/unir-productos";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const nombre = (p: PropuestaUnion) => [p.marca, p.nombre].filter(Boolean).join(" · ");

/** «BLANCO PERLA · M», o lo que haya. */
const etiquetaChoque = (c: PropuestaUnion["choques"][number]) =>
  [c.color, c.talla].filter(Boolean).join(" · ") || "sin color ni talla";

/**
 * El aviso de Stock cuando hay prendas partidas en varios productos (una
 * referencia por talla), con el botón que abre la revisión. Solo cuentan las
 * que se pueden unir: las que tienen dos variantes iguales seguramente no son
 * la misma prenda.
 */
export function AvisoUnirProductos({ propuestas }: { propuestas: PropuestaUnion[] }) {
  const [abierto, setAbierto] = useState(false);
  const unibles = propuestas.filter((p) => p.choques.length === 0);
  if (unibles.length === 0) return null;
  return (
    <Card className="border-status-pendiente/40">
      <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
        <Layers className="h-4 w-4 shrink-0 text-status-pendiente" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">
            {plural(unibles.length, "prenda está repartida", "prendas están repartidas")} en varios
            productos
          </span>{" "}
          (una referencia por talla). Al unirlas queda un producto por prenda y cada referencia pasa
          a su talla como SKU. Las existencias no cambian.
        </p>
        <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
          Revisar y unir
        </Button>
      </CardContent>
      {abierto && (
        <UnirProductosDialog propuestas={propuestas} onCerrar={() => setAbierto(false)} />
      )}
    </Card>
  );
}

/**
 * Qué se une, prenda a prenda, antes de unirlo. Cada prenda se une en su propia
 * transacción: si una falla, las demás siguen.
 */
function UnirProductosDialog({
  propuestas,
  onCerrar,
}: {
  propuestas: PropuestaUnion[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const unirFn = useServerFn(unirProductosTextil);
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(propuestas.filter((p) => p.choques.length === 0).map((p) => p.clave)),
  );
  const elegidas = propuestas.filter((p) => marcadas.has(p.clave));

  const unir = useMutation({
    mutationFn: async (lista: PropuestaUnion[]) => {
      const fallos: string[] = [];
      let unidas = 0;
      for (const p of lista) {
        try {
          await unirFn({
            data: { destino: p.destino.id, origenes: p.origenes.map((o) => o.id) },
          });
          unidas += 1;
        } catch (e) {
          fallos.push(`${nombre(p)}: ${mensajeDeError(e)}`);
        }
      }
      return { unidas, fallos };
    },
    onSuccess: ({ unidas, fallos }) => {
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["textil-productos"] });
      if (unidas > 0) toast.success(`${plural(unidas, "prenda unida", "prendas unidas")}`);
      for (const f of fallos) toast.error(f);
      if (fallos.length === 0) onCerrar();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !unir.isPending && onCerrar()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Unir los productos de una misma prenda</DialogTitle>
          <DialogDescription>
            Cada prenda de la lista son hoy varios productos, uno por referencia. Al unirla se queda
            uno, sus tallas pasan a él con su referencia como SKU y los demás se desactivan. No se
            borra nada y las existencias no cambian.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {propuestas.map((p) => {
            const referencias = [p.destino, ...p.origenes]
              .map((x) => x.referencia)
              .filter(Boolean)
              .join(", ");
            const bloqueada = p.choques.length > 0;
            return (
              <li key={p.clave} className="flex items-start gap-3 p-3">
                <Checkbox
                  className="mt-0.5"
                  aria-label={`Unir ${nombre(p)}`}
                  disabled={bloqueada || unir.isPending}
                  checked={marcadas.has(p.clave)}
                  onCheckedChange={(c) =>
                    setMarcadas((m) => {
                      const s = new Set(m);
                      if (c === true) s.add(p.clave);
                      else s.delete(p.clave);
                      return s;
                    })
                  }
                />
                <div className="min-w-0 space-y-0.5 text-sm">
                  <div className="font-medium">{nombre(p)}</div>
                  <div className="text-muted-foreground">
                    {plural(p.origenes.length + 1, "producto", "productos")} → 1
                  </div>
                  {referencias && (
                    <div className="break-words font-mono text-xs text-muted-foreground">
                      {referencias}
                    </div>
                  )}
                  {bloqueada && (
                    <p className="text-status-pendiente">
                      No se unen: {p.choques.map(etiquetaChoque).join(", ")} está en más de uno, así
                      que puede que no sean la misma prenda.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={unir.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => unir.mutate(elegidas)}
            disabled={elegidas.length === 0 || unir.isPending}
          >
            {unir.isPending ? "Uniendo…" : `Unir ${plural(elegidas.length, "prenda", "prendas")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
