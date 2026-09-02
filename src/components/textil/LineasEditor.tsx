import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, AlertTriangle, CheckCircle2, PackageX } from "lucide-react";
import { eur } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export type Linea = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_pct: number;
  stock_id?: string | null;
};

export type StockOpt = {
  id: string;
  nombre: string;
  cantidad: number;
  precio_venta: number;
  color?: string | null;
  talla?: string | null;
};

export function LineasEditor({
  items,
  onChange,
  stock = [],
}: {
  items: Linea[];
  onChange: (items: Linea[]) => void;
  stock?: StockOpt[];
}) {
  const update = (i: number, patch: Partial<Linea>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_pct: 21 }]);

  const pickStock = (i: number, id: string) => {
    if (id === "__none__") {
      update(i, { stock_id: null });
      return;
    }
    const s = stock.find((x) => x.id === id);
    if (!s) return;
    const label = [s.nombre, s.color, s.talla].filter(Boolean).join(" · ");
    update(i, {
      stock_id: s.id,
      descripcion: items[i].descripcion || label,
      precio_unitario: items[i].precio_unitario || Number(s.precio_venta) || 0,
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

  const subtotal = items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
  const iva = items.reduce((s, it) => s + it.cantidad * it.precio_unitario * (it.iva_pct / 100), 0);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Líneas</div>
      <div className="space-y-2">
        {items.map((it, i) => {
          const s = it.stock_id ? stock.find((x) => x.id === it.stock_id) : null;
          const disp = s ? Number(s.cantidad) : 0;
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
          return (
            <div key={i} className="space-y-1">
              <div className="grid grid-cols-12 gap-2 items-center">
                {stock.length > 0 && (
                  <Select value={it.stock_id ?? "__none__"} onValueChange={(v) => pickStock(i, v)}>
                    <SelectTrigger className="col-span-3 h-9 text-xs">
                      <SelectValue placeholder="Stock…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin stock</SelectItem>
                      {stock.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {[s.nombre, s.color, s.talla].filter(Boolean).join(" · ")} ({s.cantidad})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  className={stock.length > 0 ? "col-span-3" : "col-span-5"}
                  placeholder="Descripción"
                  value={it.descripcion}
                  onChange={(e) => update(i, { descripcion: e.target.value })}
                />
                <Input
                  type="number"
                  className="col-span-1"
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
              {s && (
                <div className="flex items-center gap-2 pl-1">
                  <Badge variant="outline" className={`text-[11px] gap-1 ${tono}`}>
                    <Icon className="h-3 w-3" />
                    {excede ? `Faltan ${Math.abs(restante)} uds` : `Restante ${restante} / ${disp}`}
                  </Badge>
                  {solicitadoTotal !== Number(it.cantidad) && (
                    <span className="text-[11px] text-muted-foreground">
                      · en este documento: {solicitadoTotal}
                    </span>
                  )}
                  {critico && !excede && (
                    <span className="text-[11px] text-amber-700">· stock bajo</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-2" /> Añadir línea
      </Button>
      <div className="text-right text-sm space-y-0.5 pt-2 border-t">
        <div>
          Subtotal: <span className="font-medium">{eur(subtotal)}</span>
        </div>
        <div>
          IVA: <span className="font-medium">{eur(iva)}</span>
        </div>
        <div className="text-base font-bold">Total: {eur(subtotal + iva)}</div>
      </div>
    </div>
  );
}
