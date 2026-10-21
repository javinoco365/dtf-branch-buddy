import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EtiquetaEstado } from "@/components/EtiquetaEstado";
import { eur, eurConSigno, eurUnitarioFijo, fechaCorta, numeroJusto } from "@/lib/format";
import { entradasDeProforma } from "@/lib/compras.functions";
import { sumarCantidades } from "@/dominio/sumatorios";
import {
  devueltasAntesDeFactura,
  estadoFilaRegularizacion,
  pagoPrevisto,
  regularizacionPrevista,
  type ArticuloFactura,
  type EstadoFilaRegularizacion,
  type ProformaFila,
  type StockActual,
  type SugerenciaProforma,
} from "@/dominio/proformas";
import {
  ETIQUETAS_TIPO_DOCUMENTO,
  TIPOS_DOCUMENTO_COMPRA,
  type ResumenCasado,
  type TipoDocumentoCompra,
} from "@/dominio/tipos-textil";

/**
 * Factura o proforma: lo propone la IA y lo decide la persona. Sin elegir
 * (la IA dudó), el registro espera.
 */
export function SelectorTipoDocumento({
  valor,
  onCambiar,
}: {
  valor: TipoDocumentoCompra | null;
  onCambiar: (t: TipoDocumentoCompra) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Documento</Label>
      <ToggleGroup
        type="single"
        variant="outline"
        className={`w-fit justify-start ${valor === null ? "rounded-md ring-1 ring-amber-500" : ""}`}
        value={valor ?? ""}
        onValueChange={(v) => v && onCambiar(v as TipoDocumentoCompra)}
      >
        {TIPOS_DOCUMENTO_COMPRA.map((t) => (
          <ToggleGroupItem key={t} value={t} className="h-9 px-3">
            {ETIQUETAS_TIPO_DOCUMENTO[t]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** «n.º X · 01/10/2026 · 120,00 €», para nombrar una proforma. */
const describir = (p: ProformaFila) =>
  [
    `n.º ${p.numero ?? "(sin número)"}`,
    p.fecha ? fechaCorta(p.fecha) : null,
    eur(Number(p.liquido ?? p.total ?? 0)),
  ]
    .filter(Boolean)
    .join(" · ");

const ETIQUETA_ESTADO: Record<EstadoFilaRegularizacion, string> = {
  igual: "Igual",
  coste: "Otro coste",
  mas: "Más",
  menos: "Menos",
  solo_factura: "Solo en factura",
  solo_proforma: "Solo en proforma",
};

function BadgeEstado({ estado }: { estado: EstadoFilaRegularizacion }) {
  if (estado === "igual") {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">{ETIQUETA_ESTADO[estado]}</Badge>;
  }
  if (estado === "solo_factura" || estado === "solo_proforma") {
    return <Badge variant="destructive">{ETIQUETA_ESTADO[estado]}</Badge>;
  }
  return (
    <Badge variant="outline" className="border-amber-500 text-amber-700">
      {ETIQUETA_ESTADO[estado]}
    </Badge>
  );
}

/** Lo textil de la factura, para enseñar la comparación talla a talla. */
export type DatosComparacion = {
  /** Artículos con su variante y su coste de entrada; null si el reparto no cuadra. */
  articulos: ArticuloFactura[] | null;
  stock: ReadonlyMap<string, StockActual>;
  base: number;
  /** Nombre de la variante (nombre · color · talla del catálogo). */
  etiqueta: (stock_id: string) => string;
};

/**
 * Proponer la proforma de una factura: nunca casa sola. La persona elige una,
 * o dice que no es de ninguna. Con una elegida, enseña lo que hará la base al
 * registrar: la comparación talla a talla (textil) y lo que pasa con el pago.
 */
export function CasarProforma({
  sugerencias,
  proformaId,
  sinProforma,
  onElegir,
  onNinguna,
  liquidoFactura,
  textil,
}: {
  sugerencias: readonly SugerenciaProforma<ProformaFila>[];
  proformaId: string | null;
  sinProforma: boolean;
  /** null: quitar la elegida. */
  onElegir: (id: string | null) => void;
  onNinguna: () => void;
  liquidoFactura: number;
  /** null si no es textil: solo la línea del pago. */
  textil: DatosComparacion | null;
}) {
  if (sugerencias.length === 0 && !proformaId) return null;
  const elegida = proformaId
    ? (sugerencias.find((s) => s.proforma.id === proformaId) ?? null)
    : null;
  const [mejor, ...resto] = sugerencias;

  return (
    <Card className="border-amber-500/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {elegida ? "Casada con su proforma" : "¿Es la factura de una de estas proformas?"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {proformaId && !elegida ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-destructive">
              La proforma elegida ya no encaja con este documento (proveedor, tipo o categoría):
              elige otra.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => onElegir(null)}>
              Quitar
            </Button>
          </div>
        ) : elegida ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* El icono va dentro del texto: en el móvil no se queda solo en su línea. */}
              <span>
                <Link2 className="mr-1.5 inline h-4 w-4 align-text-bottom text-status-completado" />
                Casada con la proforma{" "}
                <span className="font-medium">{describir(elegida.proforma)}</span>
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => onElegir(null)}
              >
                Cambiar
              </Button>
            </div>
            {textil && <ComparacionTallas proformaId={elegida.proforma.id} datos={textil} />}
            <LineaPago proforma={elegida.proforma} liquidoFactura={liquidoFactura} />
          </>
        ) : (
          <>
            {mejor && (
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto justify-start whitespace-normal py-1 text-left"
                  onClick={() => onElegir(mejor.proforma.id)}
                >
                  {describir(mejor.proforma)} · {mejor.puntos} puntos
                </Button>
                {mejor.motivos.length > 0 && (
                  <p className="text-xs text-muted-foreground">{mejor.motivos.join(" · ")}</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {resto.length > 0 && (
                <Select value="" onValueChange={(v) => v && onElegir(v)}>
                  <SelectTrigger className="h-9 w-auto min-w-48">
                    <SelectValue placeholder="Elegir otra…" />
                  </SelectTrigger>
                  <SelectContent>
                    {resto.map((s) => (
                      <SelectItem key={s.proforma.id} value={s.proforma.id}>
                        {describir(s.proforma)} · {s.puntos} puntos
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                type="button"
                size="sm"
                variant={sinProforma ? "default" : "outline"}
                onClick={onNinguna}
              >
                No es de ninguna
              </Button>
            </div>
            {sinProforma && (
              <p className="text-xs text-muted-foreground">
                Se registrará sola. Si su proforma ya metió el género, lo meterá otra vez: el casado
                solo se puede hacer al registrar.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Lo que pasará con el pago de la proforma al casar. */
function LineaPago({
  proforma,
  liquidoFactura,
}: {
  proforma: ProformaFila;
  liquidoFactura: number;
}) {
  const pago = pagoPrevisto(proforma, liquidoFactura);
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <EtiquetaEstado tipo="pago_compra" valor={pago.pagada ? "pagada" : "pendiente"} />
        <span>
          El pago de la proforma (
          {pago.pagada ? `pagada el ${fechaCorta(pago.fecha)}` : "pendiente de pago"},{" "}
          {eur(Number(proforma.liquido ?? proforma.total ?? 0))}) pasa a esta factura.
        </span>
      </p>
      {pago.revisarSiEnlazada && (
        <p className="text-xs text-amber-700">
          El líquido es distinto (diferencia {eur(pago.diferencia)}): si el pago está enlazado en el
          banco, ese enlace quedará por revisar.
        </p>
      )}
      {pago.pendienteSiAMano && (
        <p className="text-xs text-amber-700">
          Si la proforma se marcó pagada a mano (sin enlace en el banco), la factura quedará
          pendiente por la diferencia de {eur(pago.diferencia)} (lo pagado con la proforma ya
          cuenta). Márcala pagada cuando pagues esa diferencia.
        </p>
      )}
    </div>
  );
}

/** La comparación talla a talla entre lo que metió la proforma y lo que trae la factura. */
function ComparacionTallas({ proformaId, datos }: { proformaId: string; datos: DatosComparacion }) {
  const entradasFn = useServerFn(entradasDeProforma);
  const {
    data: entradas,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["proforma-entradas", proformaId],
    queryFn: () => entradasFn({ data: { proforma_id: proformaId } }),
  });
  const { articulos, stock, base, etiqueta } = datos;
  const prevista = useMemo(
    () =>
      entradas && articulos
        ? regularizacionPrevista({
            proforma: entradas,
            factura: articulos,
            stock,
            base_factura: base,
          })
        : null,
    [entradas, articulos, stock, base],
  );
  const devueltas = useMemo(() => (entradas ? devueltasAntesDeFactura(entradas) : []), [entradas]);

  const nombre = (id: string) =>
    id.startsWith("nueva:") ? `Variante nueva (línea ${Number(id.slice(6)) + 1})` : etiqueta(id);

  if (isLoading) {
    return (
      <p className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo lo que metió la proforma…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-destructive">
        No se ha podido leer lo que metió la proforma: {(error as Error).message}
      </p>
    );
  }
  if (!articulos) {
    return (
      <p className="text-muted-foreground">
        La comparación talla a talla sale cuando el reparto cuadre con la base.
      </p>
    );
  }
  if (!prevista) return null;
  const totalDevueltas = sumarCantidades(devueltas, (d) => d.devueltas);
  const unidadesProforma = sumarCantidades(prevista.variantes, (f) => f.unidades_proforma);
  const unidadesFactura = sumarCantidades(prevista.variantes, (f) => f.unidades_factura);

  return (
    <div className="space-y-2">
      {devueltas.length > 0 && (
        <p className="flex gap-2 rounded-md border border-amber-500/50 p-2 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            La proforma ya tiene {numeroJusto(totalDevueltas)} uds devueltas a mano al proveedor (
            {devueltas.map((d) => nombre(d.stock_id)).join(", ")}). La comparación no las descuenta:
            si la factura ya no las cobra, la regularización las sacará otra vez del stock.
          </span>
        </p>
      )}
      <Table movil="tarjetas">
        <TableHeader>
          <TableRow>
            <TableHead>Variante</TableHead>
            <TableHead className="text-right">Uds. proforma</TableHead>
            <TableHead className="text-right">Uds. factura</TableHead>
            <TableHead className="text-right">Coste proforma</TableHead>
            <TableHead className="text-right">Coste factura</TableHead>
            <TableHead>Qué pasa</TableHead>
            <TableHead className="text-right">Entran</TableHead>
            <TableHead className="text-right">Salen</TableHead>
            <TableHead className="text-right">Ajuste de coste</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {prevista.variantes.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-4 text-muted-foreground">
                Ni la proforma ni la factura traen artículos.
              </TableCell>
            </TableRow>
          )}
          {prevista.variantes.map((f) => (
            <TableRow key={f.stock_id}>
              <TableCell className="font-medium">{nombre(f.stock_id)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {numeroJusto(f.unidades_proforma)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {numeroJusto(f.unidades_factura)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {f.coste_unitario_proforma === null
                  ? "—"
                  : eurUnitarioFijo(f.coste_unitario_proforma)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {f.coste_unitario_factura === null
                  ? "—"
                  : eurUnitarioFijo(f.coste_unitario_factura)}
              </TableCell>
              <TableCell>
                <BadgeEstado estado={estadoFilaRegularizacion(f)} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {f.entran ? numeroJusto(f.entran) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {f.salen ? numeroJusto(f.salen) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {f.importe_ajuste ? eurConSigno(f.importe_ajuste) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {prevista.variantes.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">
                Total · {prevista.variantes.length} variante
                {prevista.variantes.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {numeroJusto(unidadesProforma)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {numeroJusto(unidadesFactura)}
              </TableCell>
              <TableCell colSpan={3} />
              <TableCell className="text-right font-bold tabular-nums">
                {numeroJusto(prevista.entran)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {numeroJusto(prevista.salen)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {eurConSigno(prevista.importe_ajustes)}
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
      <p className="text-xs text-muted-foreground">
        {prevista.movimientos === 0
          ? "La factura coincide con la proforma: no se mueve nada en el stock."
          : `Al registrar se anotarán ${prevista.movimientos} movimiento${
              prevista.movimientos === 1 ? "" : "s"
            } en el libro de stock. Es una previsión: manda lo que calcule la base.`}
      </p>
      {prevista.diferencia_sin_aplicar !== 0 && (
        <p className="text-xs text-muted-foreground">
          Sin aplicar (ya vendido o redondeo): {eur(prevista.diferencia_sin_aplicar)}
        </p>
      )}
    </div>
  );
}

/** El resumen del casado para el aviso tras registrar. */
export function textoCasado(casado: ResumenCasado): string {
  const partes: string[] = [];
  if (casado.stock) {
    const s = casado.stock;
    if (s.movimientos === 0) partes.push("el stock ya cuadraba");
    else {
      if (s.entran > 0) partes.push(`entran ${numeroJusto(s.entran)} uds`);
      if (s.salen > 0) partes.push(`salen ${numeroJusto(s.salen)} uds`);
      if (s.importe_ajustes !== 0) partes.push(`ajuste de coste ${eurConSigno(s.importe_ajustes)}`);
    }
  }
  const p = casado.pago;
  if (p.enlaces_movidos > 0) {
    partes.push(
      `${p.enlaces_movidos} enlace${p.enlaces_movidos === 1 ? "" : "s"} del banco pasa${
        p.enlaces_movidos === 1 ? "" : "n"
      } a la factura`,
    );
  }
  if (p.grupos_revisar > 0) {
    partes.push(
      `${p.grupos_revisar} conciliación${p.grupos_revisar === 1 ? "" : "es"} por revisar`,
    );
  }
  if (p.estado_pago === "pagada") partes.push("la factura queda pagada");
  else if (p.proforma_pagada && p.diferencia)
    partes.push(
      `la factura queda pendiente: la proforma se pagó a mano y el líquido difiere en ${eur(p.diferencia)}`,
    );
  else partes.push("la factura queda pendiente");
  return `Factura casada con su proforma: ${partes.join(", ")}.`;
}
