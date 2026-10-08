import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileArchive, Loader2 } from "lucide-react";
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
import { CLASES_ARCHIVO, entraEnArchivo, resumenArchivo, type DocArchivo } from "@/dominio/archivo";
import { urlsArchivo } from "@/lib/archivo.functions";
import { rellenarPdfsTienda } from "@/lib/facturas.functions";
import { rellenarPdfsTextil } from "@/lib/textil.functions";
import { descargarBlob } from "@/lib/csv";
import { numero } from "@/lib/format";
import { AVISO_DOCUMENTOS, montarZipArchivo, type Falta } from "@/lib/zip-archivo";

type Fase =
  | { tipo: "listo" }
  | { tipo: "generando"; hechos: number; total: number }
  | { tipo: "descargando"; hechos: number; total: number; bytes: number }
  | { tipo: "hecho"; incluidos: number; faltan: Falta[] };

/**
 * «Descargar PDFs (n)»: todos los documentos que se están viendo, en un ZIP.
 *
 * Recibe los documentos ya filtrados por la pantalla. Antes de empaquetar,
 * genera el PDF de las ventas que todavía no lo tienen guardado (de diez en
 * diez); las compras sin fichero no se pueden generar y van a FALTAN.txt.
 */
export function DescargarPdfs({
  docs,
  nombreZip,
  etiqueta = "Descargar PDFs",
}: {
  docs: readonly DocArchivo[];
  nombreZip: string;
  etiqueta?: string;
}) {
  const validos = useMemo(() => docs.filter(entraEnArchivo), [docs]);
  const resumen = useMemo(() => resumenArchivo(validos), [validos]);
  const ventasSinPdf = validos.filter((d) => d.origen !== "compra" && !d.tieneFichero).length;
  const comprasSinFichero = validos.filter((d) => d.origen === "compra" && !d.tieneFichero).length;

  const [abierto, setAbierto] = useState(false);
  const [fase, setFase] = useState<Fase>({ tipo: "listo" });
  const cancelar = useRef<AbortController | null>(null);
  const urlsFn = useServerFn(urlsArchivo);
  const rellenarTiendaFn = useServerFn(rellenarPdfsTienda);
  const rellenarTextilFn = useServerFn(rellenarPdfsTextil);
  const ocupado = fase.tipo === "generando" || fase.tipo === "descargando";

  async function descargar() {
    const control = new AbortController();
    cancelar.current = control;
    try {
      // 1. El PDF de las ventas que no lo tienen guardado.
      const pendientes = validos.filter((d) => d.origen !== "compra" && !d.tieneFichero);
      let hechos = 0;
      setFase({ tipo: "generando", hechos, total: pendientes.length });
      for (const origen of ["tienda", "textil"] as const) {
        const ids = pendientes.filter((d) => d.origen === origen).map((d) => d.id);
        for (let i = 0; i < ids.length; i += 10) {
          control.signal.throwIfAborted();
          const lote = ids.slice(i, i + 10);
          // Si una tanda falla, sus documentos irán a FALTAN.txt: no para el resto.
          await (
            origen === "tienda"
              ? rellenarTiendaFn({ data: { ids: lote, limite: 10 } })
              : rellenarTextilFn({ data: { ids: lote, limite: 10 } })
          ).catch(() => null);
          hechos += lote.length;
          setFase({ tipo: "generando", hechos, total: pendientes.length });
        }
      }

      // 2. Descargar y empaquetar.
      const { blob, incluidos, faltan } = await montarZipArchivo(validos, {
        signal: control.signal,
        firmar: async (lote) => {
          const r = await urlsFn({
            data: { items: lote.map((d) => ({ origen: d.origen, id: d.id })) },
          });
          return new Map(r.map((x) => [x.id, x.url]));
        },
        alProgreso: (p) => setFase({ tipo: "descargando", ...p }),
      });
      descargarBlob(nombreZip, blob);
      setFase({ tipo: "hecho", incluidos, faltan });
      if (faltan.length)
        toast.warning(`${faltan.length} documento(s) no han entrado: van en FALTAN.txt`);
      else toast.success(`${incluidos} documento(s) descargados`);
    } catch (e) {
      if (control.signal.aborted) {
        setFase({ tipo: "listo" });
        toast.info("Descarga cancelada");
      } else {
        setFase({ tipo: "listo" });
        toast.error((e as Error)?.message ?? "No se pudo preparar el ZIP");
      }
    } finally {
      cancelar.current = null;
    }
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={validos.length === 0}
        onClick={() => {
          setFase({ tipo: "listo" });
          setAbierto(true);
        }}
      >
        <FileArchive className="h-4 w-4 mr-2" />
        {etiqueta} ({validos.length})
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(o) => {
          if (!o) cancelar.current?.abort();
          setAbierto(o);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Descargar en un ZIP</DialogTitle>
            <DialogDescription>
              {nombreZip}: cada documento en su carpeta (emitidas, tickets, rectificativas, compras)
              y por trimestre, con un indice.csv.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-1 text-sm">
            {CLASES_ARCHIVO.filter((c) => resumen.porClase[c.valor] > 0).map((c) => (
              <li key={c.valor} className="flex justify-between">
                <span>{c.etiqueta}</span>
                <span className="font-medium">{resumen.porClase[c.valor]}</span>
              </li>
            ))}
          </ul>
          {fase.tipo === "listo" && (
            <div className="space-y-1 text-sm text-muted-foreground">
              {ventasSinPdf > 0 && (
                <p>{ventasSinPdf} venta(s) sin el PDF guardado: se generan antes de empaquetar.</p>
              )}
              {comprasSinFichero > 0 && (
                <p>{comprasSinFichero} compra(s) sin fichero: irán en la lista FALTAN.txt.</p>
              )}
              {validos.length > AVISO_DOCUMENTOS && (
                <p className="text-status-pendiente">
                  Son muchos documentos: puede tardar. Si falla, descárgalo por meses.
                </p>
              )}
            </div>
          )}

          {fase.tipo === "generando" && (
            <div className="space-y-2 text-sm">
              <p>
                Generando los PDF que faltan… {fase.hechos} de {fase.total}
              </p>
              <Progress value={fase.total ? (fase.hechos / fase.total) * 100 : 0} />
            </div>
          )}
          {fase.tipo === "descargando" && (
            <div className="space-y-2 text-sm">
              <p>
                Descargando… {fase.hechos} de {fase.total} · {numero(fase.bytes / (1024 * 1024), 1)}{" "}
                MB
              </p>
              <Progress value={fase.total ? (fase.hechos / fase.total) * 100 : 0} />
            </div>
          )}
          {fase.tipo === "hecho" && (
            <div className="space-y-1 text-sm">
              <p>{fase.incluidos} documento(s) en el ZIP.</p>
              {fase.faltan.length > 0 && (
                <>
                  <p className="text-status-pendiente">
                    {fase.faltan.length} no han entrado (están en FALTAN.txt):
                  </p>
                  <ul className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                    {fase.faltan.slice(0, 50).map((f) => (
                      <li key={f.doc.id}>
                        {f.doc.referencia || "(sin número)"} · {f.doc.tercero ?? "—"} · {f.motivo}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            {ocupado ? (
              <Button variant="outline" onClick={() => cancelar.current?.abort()}>
                Cancelar
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setAbierto(false)}>
                Cerrar
              </Button>
            )}
            {fase.tipo !== "hecho" && (
              <Button onClick={descargar} disabled={ocupado || validos.length === 0}>
                {ocupado && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Descargar {validos.length}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
