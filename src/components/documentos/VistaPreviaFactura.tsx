import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { eur } from "@/lib/format";
import { calcularTotales } from "@/dominio/importes";
import { diaLegible } from "@/dominio/fecha-documento";
import { aNumero } from "@/dominio/factura-compra";
import { lineaVacia, type LineaEditable } from "@/dominio/factura-editable";

export type EmisorVista = { nombre: string; cif: string; direccion: string };

/** El importe sin IVA de una línea, mientras se escribe. Vacío si aún no es un número. */
function baseDeLinea(l: LineaEditable): number | null {
  const cantidad = aNumero(l.cantidad);
  const precio = aNumero(l.precio_unitario);
  if (cantidad === null || precio === null) return null;
  return calcularTotales([{ cantidad, precio_unitario: precio, iva_rate: 0 }]).base_imponible;
}

/**
 * La factura tal como va a salir, con todo editable menos lo que no puede
 * cambiar: el número (lo asigna la base al emitir, correlativo), la fecha (la
 * del pedido, decisión de Javier del 8-10-2026) y los datos de la sociedad
 * (Ajustes › Empresa).
 *
 * Es una hoja blanca también en modo oscuro: tiene que parecerse al PDF.
 */
export function VistaPreviaFactura({
  emisor,
  fecha,
  nombre,
  nif,
  direccion,
  lineas,
  metodoPago,
  notas,
  totales,
  errores,
  onNombre,
  onNif,
  onDireccion,
  onLineas,
  onMetodoPago,
  onNotas,
}: {
  emisor: EmisorVista | null;
  fecha: string;
  nombre: string;
  nif: string;
  direccion: string;
  lineas: LineaEditable[];
  metodoPago: string;
  notas: string;
  /** Los de las líneas válidas: los que llevará la factura. */
  totales: ReturnType<typeof calcularTotales>;
  errores: string[];
  onNombre: (v: string) => void;
  onNif: (v: string) => void;
  onDireccion: (v: string) => void;
  onLineas: (l: LineaEditable[]) => void;
  onMetodoPago: (v: string) => void;
  onNotas: (v: string) => void;
}) {
  const cambiar = (i: number, campo: keyof LineaEditable, valor: string) =>
    onLineas(lineas.map((l, idx) => (idx === i ? { ...l, [campo]: valor } : l)));
  const quitar = (i: number) => onLineas(lineas.filter((_, idx) => idx !== i));
  const anadir = () => onLineas([...lineas, lineaVacia()]);

  // Campos con aspecto de texto impreso: sin caja hasta que se pasa por encima o se escribe.
  const campo =
    "h-8 border-neutral-200 bg-transparent px-1.5 shadow-none md:border-transparent hover:border-neutral-300 focus-visible:border-neutral-400 focus-visible:ring-0 text-neutral-900 placeholder:text-neutral-400";

  return (
    <div className="rounded-md border border-neutral-300 bg-white p-4 text-sm text-neutral-900 shadow-sm sm:p-6">
      {/* Cabecera: la sociedad a la izquierda, número y fecha a la derecha. */}
      <div className="flex flex-col gap-4 border-b border-neutral-200 pb-4 sm:flex-row sm:justify-between">
        <div className="space-y-0.5">
          <p className="font-semibold">{emisor?.nombre || "Sociedad"}</p>
          {emisor?.cif && <p className="text-neutral-600">NIF: {emisor.cif}</p>}
          {emisor?.direccion && <p className="text-neutral-600">{emisor.direccion}</p>}
          <p className="pt-1 text-[11px] text-neutral-400">Datos de Ajustes › Empresa</p>
        </div>
        <div className="space-y-0.5 sm:text-right">
          <p className="text-lg font-bold tracking-wide">FACTURA</p>
          <p className="text-neutral-600">
            Nº <span className="italic">se asigna al emitir</span>
          </p>
          <p className="text-neutral-600">
            Fecha: <span className="font-medium text-neutral-900">{diaLegible(fecha)}</span>
          </p>
          <p className="text-[11px] text-neutral-400">La fecha es la del pedido</p>
        </div>
      </div>

      {/* Cliente */}
      <div className="border-b border-neutral-200 py-4">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Facturar a
        </p>
        <div className="grid gap-1 sm:max-w-md">
          <Input
            className={`${campo} font-medium`}
            placeholder="Nombre o razón social"
            value={nombre}
            onChange={(e) => onNombre(e.target.value)}
            aria-label="Nombre del cliente"
          />
          <Input
            className={campo}
            placeholder="NIF"
            value={nif}
            onChange={(e) => onNif(e.target.value)}
            aria-label="NIF del cliente"
          />
          <Input
            className={campo}
            placeholder="Dirección"
            value={direccion}
            onChange={(e) => onDireccion(e.target.value)}
            aria-label="Dirección del cliente"
          />
        </div>
      </div>

      {/* Líneas */}
      <div className="py-4">
        <div className="hidden grid-cols-[1fr_4.5rem_3.5rem_5.5rem_3.5rem_5.5rem_2rem] gap-1 border-b border-neutral-200 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 md:grid">
          <span className="px-1.5">Descripción</span>
          <span className="px-1.5 text-right">Cant.</span>
          <span className="px-1.5">Ud.</span>
          <span className="px-1.5 text-right">Precio</span>
          <span className="px-1.5 text-right">IVA %</span>
          <span className="px-1.5 text-right">Importe</span>
          <span />
        </div>
        {lineas.map((l, i) => {
          const base = baseDeLinea(l);
          return (
            <div
              key={i}
              className="grid grid-cols-4 gap-1 border-b border-neutral-100 py-2 md:py-1 md:grid-cols-[1fr_4.5rem_3.5rem_5.5rem_3.5rem_5.5rem_2rem] md:items-center"
            >
              <Input
                className={`${campo} col-span-3 md:col-span-1`}
                placeholder="Descripción"
                value={l.descripcion}
                onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                aria-label={`Descripción de la línea ${i + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-neutral-500 hover:text-red-600 md:order-last"
                onClick={() => quitar(i)}
                aria-label={`Quitar la línea ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <CampoNumero etiqueta="Cant.">
                <Input
                  className={`${campo} text-right tabular-nums`}
                  inputMode="decimal"
                  value={l.cantidad}
                  onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                  aria-label={`Cantidad de la línea ${i + 1}`}
                />
              </CampoNumero>
              <CampoNumero etiqueta="Ud.">
                <Input
                  className={campo}
                  value={l.unidad}
                  onChange={(e) => cambiar(i, "unidad", e.target.value)}
                  aria-label={`Unidad de la línea ${i + 1}`}
                />
              </CampoNumero>
              <CampoNumero etiqueta="Precio">
                <Input
                  className={`${campo} text-right tabular-nums`}
                  inputMode="decimal"
                  value={l.precio_unitario}
                  onChange={(e) => cambiar(i, "precio_unitario", e.target.value)}
                  aria-label={`Precio sin IVA de la línea ${i + 1}`}
                />
              </CampoNumero>
              <CampoNumero etiqueta="IVA %">
                <Input
                  className={`${campo} text-right tabular-nums`}
                  inputMode="decimal"
                  value={l.iva_rate}
                  onChange={(e) => cambiar(i, "iva_rate", e.target.value)}
                  aria-label={`IVA de la línea ${i + 1}`}
                />
              </CampoNumero>
              <span className="col-span-4 self-center px-1.5 text-right tabular-nums md:col-span-1">
                <span className="mr-2 text-xs text-neutral-500 md:hidden">Importe</span>
                {base === null ? "—" : eur(base)}
              </span>
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
          onClick={anadir}
        >
          <Plus className="mr-1 h-4 w-4" /> Añadir línea
        </Button>
      </div>

      {/* Pie: método de pago y notas a la izquierda, totales a la derecha. */}
      <div className="flex flex-col gap-4 border-t border-neutral-200 pt-4 sm:flex-row sm:justify-between">
        <div className="space-y-3 sm:w-1/2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Método de pago
            </p>
            <Textarea
              rows={2}
              className="border-neutral-300 bg-white text-neutral-900"
              placeholder="Por ejemplo: Transferencia bancaria ES00…, Efectivo, Tarjeta, Bizum"
              value={metodoPago}
              onChange={(e) => onMetodoPago(e.target.value)}
              aria-label="Método de pago"
            />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Notas
            </p>
            <Textarea
              rows={2}
              className="border-neutral-300 bg-white text-neutral-900"
              value={notas}
              onChange={(e) => onNotas(e.target.value)}
              aria-label="Notas"
            />
          </div>
        </div>
        <div className="space-y-1 sm:w-64">
          <div className="flex justify-between">
            <span className="text-neutral-600">Base imponible</span>
            <span className="tabular-nums">{eur(totales.base_imponible)}</span>
          </div>
          {totales.desglose_iva.map((d) => (
            <div key={d.tipo} className="flex justify-between">
              <span className="text-neutral-600">
                IVA {d.tipo} % sobre {eur(d.base)}
              </span>
              <span className="tabular-nums">{eur(d.cuota)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-neutral-300 pt-1 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{eur(totales.total)}</span>
          </div>
        </div>
      </div>

      {errores.length > 0 && (
        <ul className="mt-4 space-y-0.5 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** En el móvil, cada número lleva su nombre encima; en pantalla ancha lo dice la cabecera. */
function CampoNumero({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="px-1.5 text-[10px] uppercase tracking-wider text-neutral-500 md:hidden">
        {etiqueta}
      </span>
      {children}
    </label>
  );
}
