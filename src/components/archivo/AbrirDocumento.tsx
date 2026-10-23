import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocArchivo } from "@/dominio/archivo";
import { urlsArchivo } from "@/lib/archivo.functions";
import { usePermisos } from "@/hooks/use-permisos";
import { rellenarPdfsTienda } from "@/lib/facturas.functions";
import { rellenarPdfsTextil } from "@/lib/textil.functions";
import { avisarError } from "@/lib/errores";

/**
 * Abre el fichero de una fila del Archivo: el PDF guardado de una venta (si no
 * lo tiene, lo genera antes, como el ZIP) o el fichero de una compra.
 *
 * La pestaña se abre ANTES de la llamada: al volver de una espera de red el
 * navegador ya no deja abrirla.
 */
export function AbrirDocumento({ doc }: { doc: DocArchivo }) {
  const qc = useQueryClient();
  const { escribir } = usePermisos();
  const urlsFn = useServerFn(urlsArchivo);
  const rellenarTiendaFn = useServerFn(rellenarPdfsTienda);
  const rellenarTextilFn = useServerFn(rellenarPdfsTextil);
  const [abriendo, setAbriendo] = useState(false);

  const generable = doc.origen !== "compra" && escribir;
  if (!doc.tieneFichero && !generable) return null;

  async function abrir() {
    const ventana = window.open("", "_blank");
    setAbriendo(true);
    try {
      if (!doc.tieneFichero) {
        await (doc.origen === "tienda"
          ? rellenarTiendaFn({ data: { ids: [doc.id], limite: 1 } })
          : rellenarTextilFn({ data: { ids: [doc.id], limite: 1 } }));
        qc.invalidateQueries({ queryKey: ["archivo"] });
      }
      const [r] = await urlsFn({ data: { items: [{ origen: doc.origen, id: doc.id }] } });
      if (!r?.url) throw new Error("No se encuentra el fichero de este documento");
      if (ventana) ventana.location.href = r.url;
      else window.location.href = r.url;
    } catch (e) {
      ventana?.close();
      avisarError(e, "No se pudo abrir el documento");
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2"
      onClick={abrir}
      disabled={abriendo}
      aria-label={`Abrir ${doc.referencia || "documento"}`}
    >
      {abriendo ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      <span className="ml-1 text-xs">{doc.ext.toUpperCase()}</span>
    </Button>
  );
}
