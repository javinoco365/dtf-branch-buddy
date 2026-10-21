import { Fragment } from "react";
import {
  ArrowLeftRight,
  ChevronRight,
  ClipboardCheck,
  GitMerge,
  History,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EtiquetaTono } from "@/components/EtiquetaEstado";
import { SiPuede } from "@/components/SiPuede";
import { cn } from "@/lib/utils";
import { eur, numero, numeroJusto } from "@/lib/format";
import { EXPLICACION_VALOR_STOCK, type TotalesStock } from "@/dominio/sumatorios-textil";
import {
  tonoStock,
  type CasillaTalla,
  type CurvaTallas,
  type FilaCurva,
  type TonoStock,
} from "@/dominio/curva-tallas";
import { disponible, utilizable } from "@/dominio/stock-textil";
import type { VarianteCatalogo } from "@/dominio/tipos-textil";

/**
 * El stock textil por prenda y color, con las tallas en columnas (la regla, en
 * src/dominio/curva-tallas.ts). En el ordenador, una tabla; en el móvil y la
 * tablet en vertical, una tarjeta por fila con las tallas en etiquetas. Al
 * pulsar una fila se abre su detalle: una línea por talla con los botones de
 * siempre (movimiento, recuento, historial, editar, borrar).
 */

/** Lo que se puede hacer con una variante desde el detalle. */
export type AccionesVariante = {
  otroMovimiento: (v: VarianteCatalogo) => void;
  recuento: (v: VarianteCatalogo) => void;
  historial: (v: VarianteCatalogo) => void;
  editar: (v: VarianteCatalogo) => void;
  borrar: (v: VarianteCatalogo) => void;
  fusionar: (v: VarianteCatalogo) => void;
};

/** Las variantes elegidas para crear un presupuesto o un pedido. */
export type SeleccionStock = {
  marcadas: ReadonlySet<string>;
  marcar: (ids: readonly string[], si: boolean) => void;
  /** Quien solo ve (visor) no elige. */
  puede: boolean;
};

export type PropsStockPorTallas = {
  curva: CurvaTallas;
  totales: TotalesStock;
  abierta: (clave: string) => boolean;
  alternar: (clave: string) => void;
  seleccion: SeleccionStock;
  acciones: AccionesVariante;
  /** Con la migración del escáner: EAN, referencia del producto y repetidas. */
  escaner: boolean;
  /** Las variantes que casan con la búsqueda, para señalarlas en el detalle. */
  destacada: (v: VarianteCatalogo) => boolean;
};

// Los mismos colores que EtiquetaTono (ámbar y rojo de la paleta de estados).
const COLOR_CIFRA: Record<TonoStock, string> = {
  neutro: "border-border bg-background",
  atencion: "border-status-pendiente/30 bg-status-pendiente/10 text-status-pendiente",
  mal: "border-status-cancelado/25 bg-status-cancelado/10 text-status-cancelado",
};
const COLOR_TEXTO: Record<TonoStock, string> = {
  neutro: "",
  atencion: "text-status-pendiente",
  mal: "text-status-cancelado",
};

const plural = (n: number, uno: string, varios: string) =>
  `${numeroJusto(n)} ${n === 1 ? uno : varios}`;

/** «M: 10 en el almacén, 2 reservadas, 8 disponibles · mínimo 3». */
function explicacionCasilla(c: CasillaTalla, talla: string): string {
  const partes = [
    plural(c.fisico, "en el almacén", "en el almacén"),
    plural(c.reservado, "reservada", "reservadas"),
    plural(c.disponible, "disponible", "disponibles"),
  ];
  const minimo = c.minimo > 0 ? ` · mínimo ${numeroJusto(c.minimo)}` : "";
  const fichas = c.variantes.length > 1 ? ` · ${c.variantes.length} fichas` : "";
  return `${talla}: ${partes.join(", ")}${minimo}${fichas}`;
}

/** Uno si todas cuestan lo mismo; si no, «6,25–6,83 €». */
function textoCoste(coste: FilaCurva["coste"]): string {
  if (!coste) return "—";
  if (coste.min === coste.max) return eur(coste.min);
  return `${numero(coste.min, 2)}–${eur(coste.max)}`;
}

/** Marca, referencia y categoría, las que haya: la segunda línea de la prenda. */
const datosPrenda = (f: FilaCurva) =>
  [f.marca, f.referencia, f.categoria].filter(Boolean).join(" · ");

/** Lo disponible de una talla, en su cajita: ámbar si toca reponer, rojo si falta. */
function CifraTalla({ c, talla }: { c: CasillaTalla; talla: string }) {
  return (
    <span
      title={explicacionCasilla(c, talla)}
      className={cn(
        "inline-flex min-w-9 justify-center rounded-md border px-1.5 py-0.5 text-sm font-medium tabular-nums",
        COLOR_CIFRA[c.tono],
      )}
    >
      {numeroJusto(c.disponible)}
    </span>
  );
}

/** Un disponible suelto (el total de una fila, el de una talla en el detalle). */
function CifraDisponible({ n, minimo = 0 }: { n: number; minimo?: number }) {
  return (
    <span className={cn("tabular-nums", COLOR_TEXTO[tonoStock(n, minimo)])}>{numeroJusto(n)}</span>
  );
}

function EtiquetasPrenda({ f, escaner }: { f: FilaCurva; escaner: boolean }) {
  const repetidas = escaner && f.variantes.some((v) => v.repetida);
  const desactivada = !f.variantes.some((v) => v.activa);
  if (!repetidas && !desactivada) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {repetidas && <EtiquetaTono tono="atencion">Repetida</EtiquetaTono>}
      {desactivada && <EtiquetaTono tono="neutro">Desactivada</EtiquetaTono>}
    </span>
  );
}

function EtiquetasVariante({ v, escaner }: { v: VarianteCatalogo; escaner: boolean }) {
  return (
    <>
      {escaner && v.repetida && <EtiquetaTono tono="atencion">Repetida</EtiquetaTono>}
      {!v.activa && <EtiquetaTono tono="neutro">Desactivada</EtiquetaTono>}
    </>
  );
}

/** La casilla de una fila: elige todas sus tallas que se pueden vender, o las quita. */
function CasillaFila({ f, seleccion }: { f: FilaCurva; seleccion: SeleccionStock }) {
  const elegibles = f.variantes.filter(utilizable).map((v) => v.id);
  const n = elegibles.filter((id) => seleccion.marcadas.has(id)).length;
  const marcada = n === 0 ? false : n === elegibles.length ? true : "indeterminate";
  return (
    <Checkbox
      aria-label={`Elegir ${[f.nombre, f.color].filter(Boolean).join(" ")} para un presupuesto o un pedido`}
      disabled={!seleccion.puede || elegibles.length === 0}
      checked={marcada}
      onCheckedChange={(c) => seleccion.marcar(elegibles, c === true)}
    />
  );
}

function CasillaVariante({ v, seleccion }: { v: VarianteCatalogo; seleccion: SeleccionStock }) {
  return (
    <Checkbox
      aria-label="Elegir para un presupuesto o un pedido"
      disabled={!seleccion.puede || !utilizable(v)}
      checked={seleccion.marcadas.has(v.id)}
      onCheckedChange={(c) => seleccion.marcar([v.id], c === true)}
    />
  );
}

function BotonesVariante({
  v,
  escaner,
  acciones,
}: {
  v: VarianteCatalogo;
  escaner: boolean;
  acciones: AccionesVariante;
}) {
  return (
    <>
      {escaner && v.repetida && (
        <SiPuede accion="borrar">
          <Button
            variant="ghost"
            size="icon"
            title="Fusionar con…"
            aria-label="Fusionar con…"
            onClick={() => acciones.fusionar(v)}
          >
            <GitMerge className="h-4 w-4 text-amber-600" />
          </Button>
        </SiPuede>
      )}
      <SiPuede accion="escribir">
        <Button
          variant="ghost"
          size="icon"
          title="Otro movimiento: merma, devolución o ajuste"
          aria-label="Otro movimiento"
          onClick={() => acciones.otroMovimiento(v)}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Recuento físico"
          aria-label="Recuento físico"
          onClick={() => acciones.recuento(v)}
        >
          <ClipboardCheck className="h-4 w-4" />
        </Button>
      </SiPuede>
      <Button
        variant="ghost"
        size="icon"
        title="Historial de movimientos"
        aria-label="Historial de movimientos"
        onClick={() => acciones.historial(v)}
      >
        <History className="h-4 w-4" />
      </Button>
      <SiPuede accion="escribir">
        <Button
          variant="ghost"
          size="icon"
          title="Editar datos"
          aria-label="Editar datos"
          onClick={() => acciones.editar(v)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </SiPuede>
      <SiPuede accion="borrar">
        <Button
          variant="ghost"
          size="icon"
          title="Eliminar"
          aria-label="Eliminar"
          onClick={() => acciones.borrar(v)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </SiPuede>
    </>
  );
}

/**
 * El detalle de una fila en el ordenador: una línea por talla. Las columnas de
 * SKU, referencia y EAN salen solo si alguna talla de esta prenda los tiene.
 */
function DetalleTallas({
  f,
  seleccion,
  acciones,
  escaner,
  destacada,
}: { f: FilaCurva } & Pick<
  PropsStockPorTallas,
  "seleccion" | "acciones" | "escaner" | "destacada"
>) {
  const conSku = f.variantes.some((v) => v.sku);
  // La referencia común ya sale en la fila; aquí, cuando cada talla tiene la suya.
  const conReferencia = escaner && !f.referencia && f.variantes.some((v) => v.producto?.referencia);
  const conEan = escaner && f.variantes.some((v) => v.ean);
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8" aria-label="Elegir" />
          <TableHead>Talla</TableHead>
          {conSku && <TableHead>SKU</TableHead>}
          {conReferencia && <TableHead>Referencia</TableHead>}
          {conEan && <TableHead>EAN</TableHead>}
          <TableHead className="text-right" title="Lo que hay si vas y lo cuentas">
            Físico
          </TableHead>
          <TableHead className="text-right" title="Comprometido en pedidos sin entregar">
            Reservado
          </TableHead>
          <TableHead className="text-right" title="Físico menos reservado: lo que puedes prometer">
            Disponible
          </TableHead>
          <TableHead className="text-right">Mín.</TableHead>
          <TableHead className="text-right">Coste</TableHead>
          <TableHead className="text-right">PVP</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {f.variantes.map((v) => (
          <TableRow key={v.id} className={cn(destacada(v) && "bg-primary/10")}>
            <TableCell>
              <CasillaVariante v={v} seleccion={seleccion} />
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{v.talla ?? "Sin talla"}</span>
                <EtiquetasVariante v={v} escaner={escaner} />
              </span>
            </TableCell>
            {conSku && <TableCell className="font-mono text-xs">{v.sku ?? "—"}</TableCell>}
            {conReferencia && (
              <TableCell className="font-mono text-xs">{v.producto?.referencia ?? "—"}</TableCell>
            )}
            {conEan && <TableCell className="font-mono text-xs">{v.ean ?? "—"}</TableCell>}
            <TableCell className="text-right tabular-nums">{numeroJusto(v.cantidad)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {v.cantidad_reservada ? numeroJusto(v.cantidad_reservada) : "—"}
            </TableCell>
            <TableCell className="text-right font-medium">
              <CifraDisponible n={disponible(v)} minimo={v.cantidad_minima} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {numeroJusto(v.cantidad_minima)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{eur(v.coste_unitario)}</TableCell>
            <TableCell className="text-right tabular-nums">{eur(v.precio_venta)}</TableCell>
            <TableCell className="whitespace-nowrap text-right">
              <BotonesVariante v={v} escaner={escaner} acciones={acciones} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** En el ordenador: una fila por prenda y color, una columna por talla. */
export function TablaStockPorTallas(p: PropsStockPorTallas) {
  const { curva, totales } = p;
  // Casilla, prenda y color; las tallas; físico, reservado, disponible y coste.
  const columnas = 3 + curva.tallas.length + 4;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" aria-label="Elegir" />
              <TableHead>Prenda</TableHead>
              <TableHead>Color</TableHead>
              {curva.tallas.map((t) => (
                <TableHead
                  key={t.clave}
                  className="px-1 text-center"
                  title={`Disponible en ${t.etiqueta}`}
                >
                  {t.etiqueta}
                </TableHead>
              ))}
              <TableHead className="text-right" title="Lo que hay si vas y lo cuentas">
                Físico
              </TableHead>
              <TableHead className="text-right" title="Comprometido en pedidos sin entregar">
                Reservado
              </TableHead>
              <TableHead
                className="text-right"
                title="Físico menos reservado: lo que puedes prometer"
              >
                Disponible
              </TableHead>
              <TableHead className="text-right">Coste</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {curva.filas.map((f) => {
              const abierta = p.abierta(f.clave);
              const datos = datosPrenda(f);
              return (
                <Fragment key={f.clave}>
                  <TableRow
                    className={cn("cursor-pointer", abierta && "border-b-0 bg-muted/40")}
                    onClick={() => p.alternar(f.clave)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <CasillaFila f={f} seleccion={p.seleccion} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <button
                          type="button"
                          className="flex items-start gap-1.5 text-left"
                          aria-expanded={abierta}
                          onClick={(e) => {
                            // La fila también abre: sin esto, se abriría y cerraría a la vez.
                            e.stopPropagation();
                            p.alternar(f.clave);
                          }}
                        >
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                              abierta && "rotate-90",
                            )}
                          />
                          <span>
                            <span className="font-medium">{f.nombre}</span>
                            {datos && (
                              <span className="block text-xs text-muted-foreground">{datos}</span>
                            )}
                          </span>
                        </button>
                        <EtiquetasPrenda f={f} escaner={p.escaner} />
                      </div>
                    </TableCell>
                    <TableCell>{f.color ?? "—"}</TableCell>
                    {curva.tallas.map((t) => {
                      const c = f.casillas.get(t.clave);
                      return (
                        <TableCell key={t.clave} className="px-1 text-center">
                          {c && <CifraTalla c={c} talla={t.etiqueta} />}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right tabular-nums">
                      {numeroJusto(f.fisico)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {f.reservado ? numeroJusto(f.reservado) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <CifraDisponible n={f.disponible} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {textoCoste(f.coste)}
                    </TableCell>
                  </TableRow>
                  {abierta && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={columnas} className="pb-3 pl-10 pt-0">
                        <div className="rounded-md border bg-background">
                          <DetalleTallas
                            f={f}
                            seleccion={p.seleccion}
                            acciones={p.acciones}
                            escaner={p.escaner}
                            destacada={p.destacada}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3 + curva.tallas.length}>
                Total · {plural(curva.filas.length, "fila", "filas")},{" "}
                {plural(totales.variantes, "variante", "variantes")}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {numero(totales.fisico, 0)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {numero(totales.reservado, 0)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {numero(totales.disponible, 0)}
              </TableCell>
              {/* El coste es por unidad y no se suma: aquí va lo que vale el stock a coste. */}
              <TableCell
                className="whitespace-nowrap text-right font-bold tabular-nums"
                title={EXPLICACION_VALOR_STOCK}
              >
                <span className="mr-1 font-normal text-muted-foreground">Valor</span>
                {eur(totales.valor)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

/** El detalle de una tarjeta en el móvil: un bloque por talla, con sus botones. */
function DetalleTallasMovil({
  f,
  seleccion,
  acciones,
  escaner,
  destacada,
}: { f: FilaCurva } & Pick<
  PropsStockPorTallas,
  "seleccion" | "acciones" | "escaner" | "destacada"
>) {
  return (
    <ul className="divide-y rounded-md border">
      {f.variantes.map((v) => {
        const referencia = v.sku ?? (f.referencia ? null : (v.producto?.referencia ?? null));
        const datos = [
          plural(v.cantidad, "en el almacén", "en el almacén"),
          v.cantidad_reservada ? plural(v.cantidad_reservada, "reservada", "reservadas") : null,
          v.cantidad_minima ? `mínimo ${numeroJusto(v.cantidad_minima)}` : null,
          `coste ${eur(v.coste_unitario)}`,
          v.precio_venta ? `PVP ${eur(v.precio_venta)}` : null,
          escaner && v.ean ? `EAN ${v.ean}` : null,
        ].filter(Boolean);
        return (
          <li key={v.id} className={cn("space-y-1 p-2", destacada(v) && "bg-primary/10")}>
            <div className="flex items-center gap-2">
              <CasillaVariante v={v} seleccion={seleccion} />
              <span className="font-medium">{v.talla ?? "Sin talla"}</span>
              {referencia && (
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {referencia}
                </span>
              )}
              <EtiquetasVariante v={v} escaner={escaner} />
              <span className="ml-auto whitespace-nowrap text-sm font-semibold">
                <CifraDisponible n={disponible(v)} minimo={v.cantidad_minima} />
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {disponible(v) === 1 ? "disponible" : "disponibles"}
                </span>
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{datos.join(" · ")}</div>
            <div className="flex flex-wrap justify-end">
              <BotonesVariante v={v} escaner={escaner} acciones={acciones} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * En el móvil y la tablet en vertical: una tarjeta por prenda y color, con sus
 * tallas en etiquetas («S 0 · M 2 · L 5»). Una tabla con una columna por talla
 * no cabe en 390 px.
 */
export function TarjetasStockPorTallas(p: PropsStockPorTallas) {
  const { curva, totales } = p;
  const etiquetaDe = new Map(curva.tallas.map((t) => [t.clave, t.etiqueta]));
  return (
    <div className="grid gap-2 md:grid-cols-2 md:items-start">
      {curva.filas.map((f) => {
        const abierta = p.abierta(f.clave);
        return (
          <Card key={f.clave}>
            <CardContent className="space-y-2 p-3">
              <div className="flex items-start gap-2">
                <span className="pt-1">
                  <CasillaFila f={f} seleccion={p.seleccion} />
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={abierta}
                  onClick={() => p.alternar(f.clave)}
                >
                  <span className="flex items-start gap-1">
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        abierta && "rotate-90",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{f.nombre}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[f.marca, f.color ?? "Sin color"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </span>
                </button>
                <div className="shrink-0 text-right">
                  <div className="font-semibold">
                    <CifraDisponible n={f.disponible} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {f.disponible === 1 ? "disponible" : "disponibles"} de {numeroJusto(f.fisico)}
                  </div>
                </div>
              </div>
              {f.casillas.size > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-11">
                  {[...f.casillas].map(([clave, c]) => {
                    const talla = etiquetaDe.get(clave) ?? clave;
                    return (
                      <span
                        key={clave}
                        title={explicacionCasilla(c, talla)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums",
                          COLOR_CIFRA[c.tono],
                        )}
                      >
                        <span className="opacity-70">{talla}</span>
                        <span className="font-semibold">{numeroJusto(c.disponible)}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="pl-11 empty:hidden">
                <EtiquetasPrenda f={f} escaner={p.escaner} />
              </div>
              {abierta && (
                <DetalleTallasMovil
                  f={f}
                  seleccion={p.seleccion}
                  acciones={p.acciones}
                  escaner={p.escaner}
                  destacada={p.destacada}
                />
              )}
            </CardContent>
          </Card>
        );
      })}
      <Card className="md:col-span-2">
        <CardContent className="flex flex-wrap gap-x-3 gap-y-1 p-3 text-sm">
          <span className="font-medium">
            Total · {plural(totales.variantes, "variante", "variantes")}
          </span>
          <span>{numero(totales.fisico, 0)} en el almacén</span>
          <span>{numero(totales.reservado, 0)} reservadas</span>
          <span className="font-semibold">{numero(totales.disponible, 0)} disponibles</span>
          <span title={EXPLICACION_VALOR_STOCK}>Valor {eur(totales.valor)}</span>
        </CardContent>
      </Card>
    </div>
  );
}
