import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { SiPuede } from "@/components/SiPuede";
import { rehacerPdfsTienda } from "@/lib/facturas.functions";
import { rehacerPdfsTextil } from "@/lib/textil.functions";
import { mensajeDeError } from "@/lib/errores";

type Fallo = { referencia: string; motivo: string };
type Lote = { total: number; hechos: number; fallidos: Fallo[]; siguiente: number };

/**
 * Rehace el PDF de todas las facturas y tickets emitidos (tiendas y textil)
 * con el diseño de hoy y reemplaza los guardados. Las cifras y los datos
 * fiscales salen de lo congelado al emitir: solo cambia cómo se ven. Solo el
 * administrador; antes de empezar dice cuántas son.
 */
export function RehacerPdfsFacturas() {
  return (
    <SiPuede accion="admin">
      <Rehacer />
    </SiPuede>
  );
}

function Rehacer() {
  const qc = useQueryClient();
  const tiendaFn = useServerFn(rehacerPdfsTienda);
  const textilFn = useServerFn(rehacerPdfsTextil);
  const [abierto, setAbierto] = useState(false);
  const [cuenta, setCuenta] = useState<{ tienda: number; textil: number } | null>(null);
  const [hechas, setHechas] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [fallos, setFallos] = useState<Fallo[]>([]);

  const abrir = async () => {
    setAbierto(true);
    setCuenta(null);
    setHechas(0);
    setFallos([]);
    try {
      const [a, b] = await Promise.all([
        tiendaFn({ data: { limite: 0 } }),
        textilFn({ data: { limite: 0 } }),
      ]);
      setCuenta({ tienda: a.total, textil: b.total });
    } catch (e) {
      toast.error(mensajeDeError(e));
      setAbierto(false);
    }
  };

  const total = (cuenta?.tienda ?? 0) + (cuenta?.textil ?? 0);

  const rehacer = async () => {
    setTrabajando(true);
    const todos: Fallo[] = [];
    let llevadas = 0;
    try {
      for (const fn of [tiendaFn, textilFn]) {
        let desde = 0;
        for (;;) {
          const r: Lote = await fn({ data: { desde, limite: 5 } });
          llevadas += r.hechos + r.fallidos.length;
          todos.push(...r.fallidos);
          setHechas(llevadas);
          if (r.siguiente <= desde || r.siguiente >= r.total) break;
          desde = r.siguiente;
        }
      }
      setFallos(todos);
      qc.invalidateQueries();
      if (todos.length === 0) {
        toast.success(`Rehechos ${llevadas} PDF con el diseño actual`);
        setAbierto(false);
      } else {
        toast.warning(
          `Rehechos ${llevadas - todos.length}; ${todos.length} no se pudieron rehacer`,
        );
      }
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={abrir}>
        <RefreshCw className="mr-2 h-4 w-4" /> Rehacer PDF de facturas
      </Button>
      <Dialog open={abierto} onOpenChange={(o) => !trabajando && setAbierto(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rehacer los PDF con el diseño actual</DialogTitle>
            <DialogDescription>
              Se vuelve a generar el PDF de cada factura y ticket emitido y se reemplaza el que
              estaba guardado. Los importes, los números y los datos fiscales son los de siempre:
              solo cambia cómo se ve.
            </DialogDescription>
          </DialogHeader>
          {!cuenta ? (
            <p className="text-sm text-muted-foreground">Contando las facturas…</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                {cuenta.tienda} de las tiendas y {cuenta.textil} de textil:{" "}
                <span className="font-medium">{total} en total</span>.
              </p>
              {(trabajando || hechas > 0) && (
                <div className="space-y-1">
                  <Progress value={total ? (hechas / total) * 100 : 0} />
                  <p className="text-xs text-muted-foreground">
                    {hechas} de {total}
                  </p>
                </div>
              )}
              {fallos.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-status-cancelado">
                  {fallos.map((f) => (
                    <li key={f.referencia}>
                      {f.referencia}: {f.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)} disabled={trabajando}>
              Cerrar
            </Button>
            <Button onClick={rehacer} disabled={!cuenta || total === 0 || trabajando}>
              {trabajando ? "Rehaciendo…" : `Rehacer ${total}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
