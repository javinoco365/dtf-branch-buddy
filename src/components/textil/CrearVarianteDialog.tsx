import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Explicacion } from "@/components/Explicacion";
import { DEFINICIONES } from "@/dominio/definiciones";
import { eur, eurUnitario, numeroJusto } from "@/lib/format";
import { claveTexto, eanValido } from "@/dominio/normalizar-textil";
import { precioRecomendado, type Recomendacion } from "@/dominio/precio-recomendado";
import { productoQueChoca } from "@/dominio/stock-textil";
import type { NuevaVariante, ProductoTextil, VarianteCatalogo } from "@/dominio/tipos-textil";

/** Una línea de factura para la que se crea una variante. */
export type LineaParaCrear = {
  /** Posición de la línea en la factura. */
  indice: number;
  descripcion: string;
  marca: string | null;
  referencia: string | null;
  /** La propuesta prerrellenada (nuevaVarianteDesdeLinea) o la que ya tenía la línea. */
  propuesta: NuevaVariante;
  /** Coste de entrada por unidad (del reparto); null si el reparto no cuadra todavía. */
  coste_entrada: number | null;
};

const PRODUCTO_NUEVO = "__nuevo__";

type ProductoForm = {
  producto_id: string | null;
  marca: string;
  referencia: string;
  nombre: string;
  categoria: string;
};

type VarianteForm = {
  color: string;
  talla: string;
  ean: string;
  sku: string;
  /** Vacío hasta que Javier lo pone: el precio no se rellena solo. */
  precio_venta: string;
  cantidad_minima: string;
};

/** Las líneas con la misma marca y referencia van al mismo producto. */
const claveGrupo = (l: LineaParaCrear) => {
  const marca = claveTexto(l.propuesta.producto?.marca ?? l.marca);
  const ref = claveTexto(l.propuesta.producto?.referencia ?? l.referencia);
  if (l.propuesta.producto_id) return `p:${l.propuesta.producto_id}`;
  return ref ? `r:${marca}|${ref}` : `l:${l.indice}`;
};

const deProducto = (p: NuevaVariante): ProductoForm => ({
  producto_id: p.producto_id,
  marca: p.producto?.marca ?? "",
  referencia: p.producto?.referencia ?? "",
  nombre: p.producto?.nombre ?? "",
  categoria: p.producto?.categoria ?? "",
});

const deVariante = (p: NuevaVariante): VarianteForm => ({
  color: p.color ?? "",
  talla: p.talla ?? "",
  ean: p.ean ?? "",
  sku: p.sku ?? "",
  precio_venta: p.precio_venta > 0 ? String(p.precio_venta) : "",
  cantidad_minima: p.cantidad_minima > 0 ? String(p.cantidad_minima) : "",
});

const nulo = (t: string) => (t.trim() === "" ? null : t.trim());

/**
 * «Crear variante» desde una línea de factura de compra (o «Crear las que
 * faltan», con varias). No escribe en la base: deja la `nueva_variante` en la
 * línea y la variante nace al registrar la factura, en la misma transacción.
 *
 * Quien lo usa lo monta solo mientras está abierto, para que el formulario
 * empiece siempre con la propuesta de las líneas.
 */
export function CrearVarianteDialog({
  open,
  onOpenChange,
  lineas,
  productos,
  catalogo,
  onGuardar,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lineas: LineaParaCrear[];
  /** Los productos del catálogo (listProductosTextil). */
  productos: readonly ProductoTextil[];
  /** Todas las variantes, para el precio recomendado. */
  catalogo: readonly VarianteCatalogo[];
  onGuardar: (r: { indice: number; nueva: NuevaVariante }[]) => void;
}) {
  const grupos = useMemo(() => {
    const m = new Map<string, LineaParaCrear[]>();
    for (const l of lineas) m.set(claveGrupo(l), [...(m.get(claveGrupo(l)) ?? []), l]);
    return [...m.entries()].map(([clave, ls]) => ({ clave, lineas: ls }));
  }, [lineas]);

  // Se monta al abrirlo: el formulario nace con la propuesta de cada línea.
  const [prods, setProds] = useState<Record<string, ProductoForm>>(() =>
    Object.fromEntries(grupos.map((g) => [g.clave, deProducto(g.lineas[0].propuesta)])),
  );
  const [vars, setVars] = useState<Record<number, VarianteForm>>(() =>
    Object.fromEntries(lineas.map((l) => [l.indice, deVariante(l.propuesta)])),
  );

  const productosActivos = productos.filter((p) => p.activo);

  const problemas: string[] = [];
  for (const g of grupos) {
    const p = prods[g.clave];
    if (p && !p.producto_id && !p.nombre.trim()) {
      problemas.push("Falta el nombre de un producto nuevo.");
    }
    // La base no reutiliza en silencio un producto con esa marca y referencia
    // y otro nombre (E-REG-26): se avisa antes.
    const choca =
      p && !p.producto_id && p.nombre.trim()
        ? productoQueChoca(productos, {
            marca: p.marca,
            referencia: p.referencia,
            nombre: p.nombre,
          })
        : null;
    if (choca) {
      problemas.push(
        `La referencia ${p.referencia.trim()} ya es del producto ${choca.nombre}; elígelo o cambia la referencia.`,
      );
    }
  }
  for (const l of lineas) {
    const v = vars[l.indice];
    if (v && v.ean.trim() && !eanValido(v.ean)) {
      problemas.push(`Línea ${l.indice + 1}: el EAN ${v.ean.trim()} no es válido.`);
    }
  }

  const guardar = () => {
    const r: { indice: number; nueva: NuevaVariante }[] = [];
    for (const g of grupos) {
      const p = prods[g.clave];
      if (!p) continue;
      for (const l of g.lineas) {
        const v = vars[l.indice];
        if (!v) continue;
        r.push({
          indice: l.indice,
          nueva: {
            producto_id: p.producto_id,
            producto: p.producto_id
              ? null
              : {
                  marca: nulo(p.marca),
                  referencia: nulo(p.referencia),
                  nombre: p.nombre.trim(),
                  categoria: nulo(p.categoria),
                },
            color: nulo(v.color),
            talla: nulo(v.talla),
            ean: nulo(v.ean),
            sku: nulo(v.sku),
            precio_venta: Math.max(0, Number(v.precio_venta.replace(",", ".")) || 0),
            cantidad_minima: Math.max(0, Number(v.cantidad_minima) || 0),
          },
        });
      }
    }
    onGuardar(r);
    onOpenChange(false);
  };

  const varias = lineas.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {varias ? `Crear las variantes que faltan (${lineas.length})` : "Crear variante"}
          </DialogTitle>
          <DialogDescription>
            Se crean al registrar la factura, con sus existencias y su coste de entrada. Hasta
            entonces no se guarda nada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {grupos.map((g) => {
            const p = prods[g.clave];
            if (!p) return null;
            const setP = (cambio: Partial<ProductoForm>) =>
              setProds((s) => ({ ...s, [g.clave]: { ...p, ...cambio } }));
            return (
              <div key={g.clave} className="space-y-3 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Producto</Label>
                  <Select
                    value={p.producto_id ?? PRODUCTO_NUEVO}
                    onValueChange={(v) => setP({ producto_id: v === PRODUCTO_NUEVO ? null : v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PRODUCTO_NUEVO}>Producto nuevo</SelectItem>
                      {productosActivos.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {[x.marca, x.referencia, x.nombre].filter(Boolean).join(" · ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!p.producto_id && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CampoTexto
                      etiqueta="Marca de la prenda"
                      valor={p.marca}
                      onChange={(marca) => setP({ marca })}
                    />
                    <CampoTexto
                      etiqueta="Referencia del fabricante"
                      valor={p.referencia}
                      onChange={(referencia) => setP({ referencia })}
                    />
                    <CampoTexto
                      etiqueta="Nombre *"
                      valor={p.nombre}
                      onChange={(nombre) => setP({ nombre })}
                    />
                    <CampoTexto
                      etiqueta="Categoría"
                      valor={p.categoria}
                      onChange={(categoria) => setP({ categoria })}
                    />
                  </div>
                )}

                {g.lineas.map((l) => {
                  const v = vars[l.indice];
                  if (!v) return null;
                  const setV = (cambio: Partial<VarianteForm>) =>
                    setVars((s) => ({ ...s, [l.indice]: { ...v, ...cambio } }));
                  const eanMal = v.ean.trim() !== "" && !eanValido(v.ean);
                  const recomendado =
                    l.coste_entrada !== null
                      ? precioRecomendado(
                          { id: null, producto_id: p.producto_id, coste_unitario: l.coste_entrada },
                          catalogo,
                        )
                      : null;
                  return (
                    <div key={l.indice} className="space-y-2 border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        Línea {l.indice + 1}: {l.descripcion}
                        {l.coste_entrada !== null && (
                          <> · coste de entrada {eurUnitario(l.coste_entrada)} por unidad</>
                        )}
                      </p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <CampoTexto
                          etiqueta="Color"
                          valor={v.color}
                          onChange={(color) => setV({ color })}
                        />
                        <CampoTexto
                          etiqueta="Talla"
                          valor={v.talla}
                          onChange={(talla) => setV({ talla })}
                        />
                        <div className="space-y-1.5">
                          <Label className="text-xs">EAN</Label>
                          <Input
                            inputMode="numeric"
                            value={v.ean}
                            className={eanMal ? "border-destructive" : ""}
                            onChange={(e) => setV({ ean: e.target.value })}
                          />
                          {eanMal && (
                            <p className="text-xs text-destructive">
                              No es un EAN válido: corrígelo o déjalo vacío.
                            </p>
                          )}
                        </div>
                        <CampoTexto
                          etiqueta="SKU"
                          valor={v.sku}
                          onChange={(sku) => setV({ sku })}
                        />
                        <div className="space-y-1.5">
                          <Label className="text-xs">Precio de venta</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={v.precio_venta}
                            onChange={(e) => setV({ precio_venta: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Mínimo</Label>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            value={v.cantidad_minima}
                            onChange={(e) => setV({ cantidad_minima: e.target.value })}
                          />
                        </div>
                      </div>
                      <TextoRecomendado recomendacion={recomendado} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-2">
          {problemas.length > 0 && (
            <span className="mr-auto text-sm text-destructive">{problemas[0]}</span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={problemas.length > 0} onClick={guardar}>
            {varias ? `Crear ${lineas.length} variantes al registrar` : "Crear al registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Recomendado: X € (×R sobre coste, mediana de N prendas…)» o «Sin datos para
 * recomendar». Solo informa: no rellena el precio.
 */
export function TextoRecomendado({
  recomendacion,
  sinDatos = "Sin datos para recomendar",
}: {
  recomendacion: Recomendacion | null;
  sinDatos?: string;
}) {
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      {recomendacion ? (
        <span>
          Recomendado:{" "}
          <span className="font-medium text-foreground">{eur(recomendacion.precio)}</span> (×
          {numeroJusto(recomendacion.ratio, 2)} sobre coste, mediana de {recomendacion.muestras}{" "}
          {recomendacion.muestras === 1 ? "prenda" : "prendas"}{" "}
          {recomendacion.fuente === "producto" ? "del mismo producto" : "de tu catálogo"})
        </span>
      ) : (
        <span>{sinDatos}</span>
      )}
      <Explicacion titulo="Precio recomendado" definicion={DEFINICIONES.g_precio_recomendado} />
    </p>
  );
}

function CampoTexto({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{etiqueta}</Label>
      <Input value={valor} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
