import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, AlertTriangle, CheckCircle2, PackageX, PackageSearch } from "lucide-react";
import { eur, eurUnitario, numero, numeroJusto } from "@/lib/format";
import { calcularTotales } from "@/dominio/importes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Explicacion } from "@/components/Explicacion";
import { DEFINICIONES } from "@/dominio/definiciones";
import { disponible, etiquetaVariante, margenPrevisto, utilizable } from "@/dominio/stock-textil";
import { precioRecomendado } from "@/dominio/precio-recomendado";
import type { LineaDocumentoTextil, VarianteCatalogo } from "@/dominio/tipos-textil";
import { SelectorStockTextil } from "./SelectorStockTextil";

/** Una línea de presupuesto o pedido textil. */
export type Linea = LineaDocumentoTextil;

/** El coste de una línea: el congelado si lo trae; si no, el medio de su variante. */
function costeDeLinea(it: Linea, v: VarianteCatalogo | null | undefined): number | null {
  if (it.coste_unit_snapshot !== null && it.coste_unit_snapshot !== undefined) {
    return Number(it.coste_unit_snapshot);
  }
  return v ? v.coste_unitario : null;
}

export function LineasEditor({
  items,
  onChange,
  stock = [],
  reservadoPropio,
  bloquearFaltante = false,
}: {
  items: Linea[];
  onChange: (items: Linea[]) => void;
  /** El catálogo (las páginas mapean listStock con aVarianteCatalogo). */
  stock?: VarianteCatalogo[];
  /** Lo que reserva el propio pedido que se edita: no se cuenta como ocupado. */
  reservadoPropio?: ReadonlyMap<string, number>;
  /** Un pedido no puede llevar más de lo disponible; un presupuesto solo avisa. */
  bloquearFaltante?: boolean;
}) {
  const [eligiendo, setEligiendo] = useState(false);
  const porId = useMemo(() => new Map(stock.map((s) => [s.id, s])), [stock]);
  // Al desplegable, solo las que se pueden vender (activas y no repetidas).
  const vendibles = useMemo(() => stock.filter(utilizable), [stock]);

  const update = (i: number, patch: Partial<Linea>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_pct: 21 }]);

  const pickStock = (i: number, id: string) => {
    if (id === "__none__") {
      update(i, { stock_id: null, coste_unit_snapshot: null });
      return;
    }
    const s = porId.get(id);
    if (!s) return;
    update(i, {
      stock_id: s.id,
      descripcion: items[i].descripcion || etiquetaVariante(s),
      precio_unitario: items[i].precio_unitario || s.precio_venta || 0,
      // El coste congelado era de la variante anterior.
      coste_unit_snapshot: id === items[i].stock_id ? items[i].coste_unit_snapshot : null,
    });
  };

  // Agregado por stock_id considerando TODAS las líneas — indicador en tiempo real
  const totalPorStock = new Map<string, number>();
  for (const it of items) {
    if (!it.stock_id) continue;
    totalPorStock.set(
      it.stock_id,
      (totalPorStock.get(it.stock_id) ?? 0) + Number(it.cantidad || 0),
    );
  }

  // Mismo cálculo que al guardar: lo que se ve aquí es lo que se graba.
  const totales = calcularTotales(items.map((it) => ({ ...it, iva_rate: it.iva_pct })));
  const margen = margenPrevisto(
    items.map((it) => ({
      cantidad: Number(it.cantidad) || 0,
      precio_unitario: Number(it.precio_unitario) || 0,
      coste_unitario: it.stock_id ? costeDeLinea(it, porId.get(it.stock_id)) : null,
    })),
  );
  const conPrenda = items.some((it) => it.stock_id);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Líneas</div>
      <div className="space-y-2">
        {items.map((it, i) => {
          const s = it.stock_id ? (porId.get(it.stock_id) ?? null) : null;
          const disp = s ? disponible(s, reservadoPropio?.get(s.id) ?? 0) : 0;
          const solicitadoTotal = s ? (totalPorStock.get(s.id) ?? 0) : 0;
          const restante = disp - solicitadoTotal;
          const excede = !!s && restante < 0;
          const critico = !!s && !excede && restante <= disp * 0.1; // <=10% restante
          const tono = excede
            ? "bg-destructive/10 text-destructive border-destructive/30"
            : critico
              ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
              : "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
          const Icon = excede ? PackageX : critico ? AlertTriangle : CheckCircle2;
          const coste = s ? costeDeLinea(it, s) : null;
          const sinPrecio = !(Number(it.precio_unitario) > 0);
          const recomendado =
            s && sinPrecio && coste !== null && coste > 0
              ? precioRecomendado(
                  { id: s.id, producto_id: s.producto_id, coste_unitario: coste },
                  stock,
                )
              : null;
          // Una línea vieja con una variante que ya no se vende se sigue viendo.
          const opciones = s && !utilizable(s) ? [s, ...vendibles] : vendibles;
          return (
            <div key={i} className="space-y-1 max-md:rounded-md max-md:border max-md:p-2">
              <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-center">
                {stock.length > 0 && (
                  <Select value={it.stock_id ?? "__none__"} onValueChange={(v) => pickStock(i, v)}>
                    <SelectTrigger className="col-span-6 md:col-span-3 h-9 text-xs">
                      <SelectValue placeholder="Stock…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin stock</SelectItem>
                      {opciones.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {etiquetaVariante(o)} (
                          {numeroJusto(disponible(o, reservadoPropio?.get(o.id) ?? 0))} disp.)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  className={
                    stock.length > 0 ? "col-span-6 md:col-span-3" : "col-span-6 md:col-span-5"
                  }
                  placeholder="Descripción"
                  value={it.descripcion}
                  onChange={(e) => update(i, { descripcion: e.target.value })}
                />
                <Input
                  type="number"
                  className="col-span-2 md:col-span-1"
                  placeholder="Cant."
                  aria-label="Cantidad"
                  value={it.cantidad}
                  onChange={(e) => update(i, { cantidad: Number(e.target.value) })}
                />
                <Input
                  type="number"
                  step="0.01"
                  className="col-span-2 md:col-span-2"
                  placeholder="Precio"
                  aria-label="Precio"
                  value={it.precio_unitario}
                  onChange={(e) => update(i, { precio_unitario: Number(e.target.value) })}
                />
                <Input
                  type="number"
                  className="col-span-1 md:col-span-2"
                  placeholder="IVA %"
                  aria-label="IVA %"
                  value={it.iva_pct}
                  onChange={(e) => update(i, { iva_pct: Number(e.target.value) })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Quitar la línea"
                  onClick={() => remove(i)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              {s && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-1">
                  <Badge variant="outline" className={`text-[11px] gap-1 ${tono}`}>
                    <Icon className="h-3 w-3" />
                    {excede
                      ? `Faltan ${numeroJusto(Math.abs(restante))} uds`
                      : `Restante ${numeroJusto(restante)} / ${numeroJusto(disp)} disponibles`}
                  </Badge>
                  {solicitadoTotal !== Number(it.cantidad) && (
                    <span className="text-[11px] text-muted-foreground">
                      · en este documento: {numeroJusto(solicitadoTotal)}
                    </span>
                  )}
                  {critico && !excede && (
                    <span className="text-[11px] text-amber-700">· stock bajo</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    · {coste !== null && coste > 0 ? `Coste ${eurUnitario(coste)}` : "Sin coste"}
                  </span>
                  {sinPrecio && recomendado && (
                    <span className="text-[11px] text-muted-foreground">
                      · Recomendado: {eur(recomendado.precio)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4 mr-2" /> Añadir línea
        </Button>
        {stock.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setEligiendo(true)}>
            <PackageSearch className="h-4 w-4 mr-2" /> Elegir del stock
          </Button>
        )}
      </div>
      <div className="text-right text-sm space-y-0.5 pt-2 border-t">
        <div>
          Subtotal: <span className="font-medium">{eur(totales.base_imponible)}</span>
        </div>
        <div>
          IVA: <span className="font-medium">{eur(totales.iva_total)}</span>
        </div>
        <div className="text-base font-bold">Total: {eur(totales.total)}</div>
        {conPrenda && (
          <div className="flex flex-wrap items-center justify-end gap-1 pt-1 text-xs text-muted-foreground">
            {margen.base > 0 || margen.coste > 0 ? (
              <span>
                Coste previsto {eur(margen.coste)} · Margen previsto{" "}
                <span className="font-medium text-foreground">{eur(margen.margen)}</span>
                {margen.porcentaje !== null && ` (${numero(margen.porcentaje, 1)} %)`}
              </span>
            ) : (
              <span>Margen previsto: —</span>
            )}
            {margen.lineasSinCoste > 0 && (
              <span>
                · {margen.lineasSinCoste} línea{margen.lineasSinCoste === 1 ? "" : "s"} sin coste
              </span>
            )}
            <Explicacion titulo="Margen previsto" definicion={DEFINICIONES.m_margen_previsto} />
          </div>
        )}
      </div>
      {eligiendo && (
        <SelectorStockTextil
          open
          onOpenChange={setEligiendo}
          modo="cantidades"
          variantes={stock}
          reservadoPropio={reservadoPropio}
          enDocumento={totalPorStock}
          bloquearFaltante={bloquearFaltante}
          onAnadir={(nuevas) => {
            // La línea vacía del documento nuevo se sustituye; las demás se quedan.
            const conContenido = items.filter(
              (it) => it.descripcion.trim() || it.stock_id || Number(it.precio_unitario) > 0,
            );
            onChange([...conContenido, ...nuevas]);
          }}
        />
      )}
    </div>
  );
}
