import { useState } from "react";
import { AlertTriangle, Check, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiPuede } from "@/components/SiPuede";
import { eur } from "@/lib/format";
import { mensajeDeError } from "@/lib/errores";
import { calcularLinea } from "@/dominio/importes";

/** Lo que la preparación dice de un documento que ya no cuadra con el pedido. */
export type Descuadre = {
  /** Lo que suma el documento emitido. */
  facturado: number;
  /** Lo que pagó de verdad el cliente: las líneas menos lo devuelto. */
  real: number;
  devuelto: number;
  /** Devuelto entero: se anula y no hace falta documento nuevo. */
  devuelto_entero: boolean;
  /** Las líneas del documento nuevo, con las devoluciones en negativo. */
  lineas: {
    descripcion: string;
    cantidad: number;
    unidad: string;
    precio_unitario: number;
    iva_rate: number;
  }[];
};

export type PasoCorreccion = "rectificar" | "emitir";

export type ResultadoCorreccion = {
  rectificativa: string;
  nuevo: { id: string; referencia: string } | null;
};

type Estado =
  | { fase: "explicar" }
  | { fase: "confirmar" }
  | { fase: "trabajando"; paso: PasoCorreccion }
  | { fase: "hecho"; resultado: ResultadoCorreccion }
  | { fase: "error"; paso: PasoCorreccion; mensaje: string };

/**
 * Corregir el ticket o la factura de un pedido que ya no cuadra, paso a paso.
 *
 * Decisión de Javier (15-11-2026): cuando al cliente se le devuelve algo
 * después de emitir el documento, se corrige con una rectificativa que lo
 * anula entero y un documento nuevo, del mismo tipo, por lo que pagó al
 * final (con la devolución en negativo). Todo guiado: primero se explica qué
 * ha pasado y qué se va a hacer, después se confirma y se ve cada paso.
 *
 * Un documento emitido no se edita ni se borra (CLAUDE.md): por eso la
 * rectificativa. Las dos emisiones no van en la misma transacción; si la
 * segunda falla, la pantalla lo dice y el pedido queda sin documento, listo
 * para emitirlo de nuevo con «Reintentar» o desde la lista.
 */
export function CorregirDocumento({
  referencia,
  tipo,
  descuadre,
  corregir,
  reintentarEmision,
  abrirPdf,
  onTerminar,
}: {
  referencia: string;
  tipo: string;
  descuadre: Descuadre;
  /**
   * Rectifica y emite el nuevo. Avisa de cada paso con `alAvanzar`; al pasar
   * a «emitir», con la referencia de la rectificativa ya emitida.
   */
  corregir: (
    alAvanzar: (paso: PasoCorreccion, rectificativa?: string) => void,
  ) => Promise<ResultadoCorreccion>;
  /** Solo el documento nuevo, si la rectificativa ya se emitió y lo nuevo falló. */
  reintentarEmision: () => Promise<{ id: string; referencia: string }>;
  abrirPdf: (id: string) => Promise<string | null>;
  onTerminar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "explicar" });
  const [rectificativaHecha, setRectificativaHecha] = useState<string | null>(null);
  const esTicket = tipo === "simplificada";
  const doc = esTicket ? "el ticket" : "la factura";
  const nuevoDoc = esTicket ? "un ticket nuevo" : "una factura nueva";

  async function lanzar() {
    let paso: PasoCorreccion = "rectificar";
    try {
      const resultado = await corregir((p, rectificativa) => {
        if (rectificativa) setRectificativaHecha(rectificativa);
        paso = p;
        setEstado({ fase: "trabajando", paso: p });
      });
      setEstado({ fase: "hecho", resultado });
    } catch (e) {
      setEstado({ fase: "error", paso, mensaje: mensajeDeError(e, "No se ha podido corregir") });
    }
  }

  async function reintentar() {
    setEstado({ fase: "trabajando", paso: "emitir" });
    try {
      const nuevo = await reintentarEmision();
      setEstado({
        fase: "hecho",
        resultado: { rectificativa: rectificativaHecha ?? "", nuevo },
      });
    } catch (e) {
      setEstado({
        fase: "error",
        paso: "emitir",
        mensaje: mensajeDeError(e, "No se ha podido emitir el documento nuevo"),
      });
    }
  }

  async function verPdf(id: string) {
    // La pestaña se abre ya, con el clic: al volver de la red el navegador no
    // deja abrir ventanas (como en DocumentoPedidoDialog).
    const ventana = window.open("", "_blank");
    const url = await abrirPdf(id).catch(() => null);
    if (url && ventana) ventana.location.href = url;
    else ventana?.close();
  }

  const cifras = (
    <dl className="grid grid-cols-3 gap-2 rounded-md border p-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Facturado</dt>
        <dd className="font-semibold tabular-nums">{eur(descuadre.facturado)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Devuelto</dt>
        <dd className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">
          −{eur(descuadre.devuelto)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Pagó al final</dt>
        <dd className="font-semibold tabular-nums">{eur(descuadre.real)}</dd>
      </div>
    </dl>
  );

  if (estado.fase === "explicar") {
    return (
      <div className="space-y-4 py-2 text-sm">
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p>
            {esTicket ? "El ticket" : "La factura"} <strong>{referencia}</strong> ya no cuadra: al
            cliente se le devolvió dinero después de emitirlo.
          </p>
        </div>
        {cifras}
        <div className="space-y-2">
          <p className="font-medium">Para corregirlo, en dos pasos:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Se emite una <strong>rectificativa</strong> que anula {doc} {referencia} entero.
            </li>
            {descuadre.devuelto_entero ? (
              <li>
                No hace falta documento nuevo: se devolvió todo, así que el pedido queda sin
                documento.
              </li>
            ) : (
              <li>
                Se emite {nuevoDoc} por <strong>{eur(descuadre.real)}</strong>, con las líneas del
                pedido y la devolución en negativo:
              </li>
            )}
          </ol>
        </div>
        {!descuadre.devuelto_entero && (
          <ul className="divide-y rounded-md border">
            {descuadre.lineas.map((l, i) => {
              const total = calcularLinea(l).total;
              return (
                <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">{l.descripcion}</span>
                  <span
                    className={`shrink-0 tabular-nums ${total < 0 ? "text-amber-700 dark:text-amber-300" : ""}`}
                  >
                    {eur(total)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onTerminar}>
            Ahora no
          </Button>
          <SiPuede accion="escribir">
            <Button onClick={() => setEstado({ fase: "confirmar" })}>Continuar</Button>
          </SiPuede>
        </div>
      </div>
    );
  }

  if (estado.fase === "confirmar") {
    return (
      <div className="space-y-4 py-2 text-sm">
        <p className="font-medium">¿Corregir ahora?</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>La rectificativa gasta un número de la serie y no tiene vuelta atrás.</li>
          {!descuadre.devuelto_entero && (
            <li>
              {nuevoDoc.charAt(0).toUpperCase() + nuevoDoc.slice(1)} lleva la fecha del pedido, como
              siempre.
            </li>
          )}
          <li>Tarda unos segundos: no cierres esta ventana.</li>
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setEstado({ fase: "explicar" })}>
            Volver
          </Button>
          <Button onClick={lanzar}>
            {descuadre.devuelto_entero ? "Emitir la rectificativa" : "Rectificar y emitir el nuevo"}
          </Button>
        </div>
      </div>
    );
  }

  const pasos: { clave: PasoCorreccion; texto: string }[] = [
    { clave: "rectificar", texto: `Rectificativa que anula ${doc} ${referencia}` },
    ...(descuadre.devuelto_entero
      ? []
      : [{ clave: "emitir" as const, texto: `${nuevoDoc} por ${eur(descuadre.real)}` }]),
  ];
  const orden = (p: PasoCorreccion) => (p === "rectificar" ? 0 : 1);
  const icono = (clave: PasoCorreccion) => {
    if (estado.fase === "hecho") return <Check className="h-4 w-4 text-green-600" />;
    const actual = estado.paso;
    if (orden(clave) < orden(actual)) return <Check className="h-4 w-4 text-green-600" />;
    if (clave === actual) {
      return estado.fase === "error" ? (
        <X className="h-4 w-4 text-destructive" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin" />
      );
    }
    return <span className="inline-block h-4 w-4 rounded-full border" />;
  };

  return (
    <div className="space-y-4 py-2 text-sm">
      <ol className="space-y-2">
        {pasos.map((p) => (
          <li key={p.clave} className="flex items-center gap-2">
            {icono(p.clave)}
            <span className="first-letter:uppercase">{p.texto}</span>
          </li>
        ))}
      </ol>

      {estado.fase === "error" && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-destructive">{estado.mensaje}</p>
          {estado.paso === "emitir" ? (
            <p>
              La rectificativa ya está emitida y el pedido se ha quedado sin documento. Pulsa
              «Reintentar» o emítelo más tarde desde la lista de pedidos.
            </p>
          ) : (
            <p>
              La rectificativa no se ha emitido: {doc} sigue como estaba. Si el fallo fue de
              conexión, mira en Facturas que {doc} no esté ya rectificado antes de volver a
              intentarlo.
            </p>
          )}
        </div>
      )}

      {estado.fase === "hecho" && (
        <div className="space-y-2 rounded-md border border-green-600/40 bg-green-600/5 p-3">
          <p className="font-medium">Corregido.</p>
          {estado.resultado.rectificativa && (
            <p>Rectificativa emitida: {estado.resultado.rectificativa}.</p>
          )}
          {estado.resultado.nuevo && (
            <p className="flex flex-wrap items-center gap-2">
              Documento nuevo: <strong>{estado.resultado.nuevo.referencia}</strong>
              <Button
                size="sm"
                variant="outline"
                onClick={() => verPdf(estado.resultado.nuevo!.id)}
              >
                <FileText className="mr-1 h-4 w-4" />
                Ver PDF
              </Button>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {estado.fase === "error" && estado.paso === "emitir" && (
          <Button onClick={reintentar}>Reintentar</Button>
        )}
        {(estado.fase === "hecho" || estado.fase === "error") && (
          <Button variant={estado.fase === "hecho" ? "default" : "outline"} onClick={onTerminar}>
            Cerrar
          </Button>
        )}
      </div>
    </div>
  );
}
