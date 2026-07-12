import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import { eur } from "@/lib/format";

export type Linea = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_pct: number;
  stock_id?: string | null;
};

export function LineasEditor({
  items,
  onChange,
}: {
  items: Linea[];
  onChange: (items: Linea[]) => void;
}) {
  const update = (i: number, patch: Partial<Linea>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_pct: 21 }]);

  const subtotal = items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
  const iva = items.reduce(
    (s, it) => s + it.cantidad * it.precio_unitario * (it.iva_pct / 100),
    0,
  );

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Líneas</div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <Input
              className="col-span-5"
              placeholder="Descripción"
              value={it.descripcion}
              onChange={(e) => update(i, { descripcion: e.target.value })}
            />
            <Input
              type="number"
              className="col-span-2"
              placeholder="Cant."
              value={it.cantidad}
              onChange={(e) => update(i, { cantidad: Number(e.target.value) })}
            />
            <Input
              type="number"
              step="0.01"
              className="col-span-2"
              placeholder="Precio"
              value={it.precio_unitario}
              onChange={(e) => update(i, { precio_unitario: Number(e.target.value) })}
            />
            <Input
              type="number"
              className="col-span-2"
              placeholder="IVA %"
              value={it.iva_pct}
              onChange={(e) => update(i, { iva_pct: Number(e.target.value) })}
            />
            <Button variant="ghost" size="icon" onClick={() => remove(i)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-2" /> Añadir línea
      </Button>
      <div className="text-right text-sm space-y-0.5 pt-2 border-t">
        <div>Subtotal: <span className="font-medium">{eur(subtotal)}</span></div>
        <div>IVA: <span className="font-medium">{eur(iva)}</span></div>
        <div className="text-base font-bold">Total: {eur(subtotal + iva)}</div>
      </div>
    </div>
  );
}