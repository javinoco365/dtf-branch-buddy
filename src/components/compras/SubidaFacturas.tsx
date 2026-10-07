import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CopyX, FileUp, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { subirFacturaRecibida } from "@/lib/compras.functions";

/**
 * Subir varias facturas de golpe, eligiéndolas o arrastrándolas.
 *
 * Van una a una (cada lectura con IA tarda unos segundos y así no se pisa el
 * límite de tiempo del servidor) y cada una dice cómo ha quedado. Un fichero
 * repetido en la misma tanda no se manda dos veces; uno ya subido antes lo
 * detecta el servidor.
 */

type Estado = "esperando" | "leyendo" | "pendiente" | "duplicado" | "error";
type Subida = { nombre: string; estado: Estado; motivo?: string };

const ACEPTADOS = "application/pdf,image/jpeg,image/png,image/webp";

async function huella(f: File): Promise<string> {
  const resumen = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function SubidaFacturas({
  deshabilitado,
  alTerminarUna,
}: {
  deshabilitado: boolean;
  /** Tras cada factura, para refrescar la cola. */
  alTerminarUna: () => void;
}) {
  const ficheroRef = useRef<HTMLInputElement>(null);
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [encima, setEncima] = useState(false);
  const subirFn = useServerFn(subirFacturaRecibida);
  const trabajando = subidas.some((s) => s.estado === "esperando" || s.estado === "leyendo");

  const subir = async (ficheros: File[]) => {
    if (ficheros.length === 0 || trabajando) return;
    const lista: Subida[] = ficheros.map((f) => ({ nombre: f.name, estado: "esperando" }));
    setSubidas(lista);
    const poner = (i: number, cambio: Partial<Subida>) =>
      setSubidas((s) => s.map((x, j) => (j === i ? { ...x, ...cambio } : x)));
    const vistas = new Map<string, string>();
    for (const [i, f] of ficheros.entries()) {
      try {
        const h = await huella(f);
        const igual = vistas.get(h);
        if (igual) {
          poner(i, { estado: "duplicado", motivo: `Es el mismo fichero que «${igual}».` });
          continue;
        }
        vistas.set(h, f.name);
        poner(i, { estado: "leyendo" });
        const fd = new FormData();
        fd.append("fichero", f);
        const r = (await subirFn({ data: fd })) as
          | { resultado: "pendiente"; motivos: string[] }
          | { resultado: "error" | "duplicado"; motivo: string };
        if (r.resultado === "pendiente") {
          poner(i, {
            estado: "pendiente",
            motivo: r.motivos.length
              ? `${r.motivos.length} cosa(s) que mirar`
              : "Leída. Revísala y regístrala.",
          });
        } else {
          poner(i, { estado: r.resultado, motivo: r.motivo });
        }
      } catch (e) {
        poner(i, { estado: "error", motivo: e instanceof Error ? e.message : String(e) });
      }
      alTerminarUna();
    }
  };

  const icono = (e: Estado) => {
    if (e === "leyendo" || e === "esperando")
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (e === "pendiente") return <CheckCircle2 className="h-4 w-4 text-status-completado" />;
    if (e === "duplicado") return <CopyX className="h-4 w-4 text-amber-600" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  return (
    <div className="space-y-2">
      <input
        ref={ficheroRef}
        type="file"
        multiple
        accept={ACEPTADOS}
        className="hidden"
        onChange={(e) => {
          const lista = [...(e.target.files ?? [])];
          e.target.value = "";
          void subir(lista);
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!deshabilitado) setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          if (!deshabilitado) void subir([...e.dataTransfer.files]);
        }}
        className={`flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm ${
          encima ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <Button onClick={() => ficheroRef.current?.click()} disabled={deshabilitado || trabajando}>
          {trabajando ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileUp className="h-4 w-4 mr-2" />
          )}
          {trabajando ? "Leyendo…" : "Subir facturas"}
        </Button>
        <span className="text-muted-foreground">
          o arrastra aquí los PDF. La IA las lee y quedan por revisar: no cuentan hasta que las
          registres.
        </span>
      </div>
      {subidas.length > 0 && (
        <Card>
          <CardContent className="space-y-1.5 py-3 text-sm">
            {subidas.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5">{icono(s.estado)}</span>
                <span className="font-medium break-all">{s.nombre}</span>
                {s.motivo && <span className="text-muted-foreground">· {s.motivo}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
