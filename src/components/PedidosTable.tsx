import { useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Search,
} from "lucide-react";
import { eur, metros } from "@/lib/format";
import {
  descargarCSV,
  generarPedidosRango,
  TIENDAS_DEMO,
  type PedidoDemo,
} from "@/lib/demo-data";

type Periodo = "mes" | "semana";

type PedidoFila = PedidoDemo & {
  numero: string;
  cliente: string;
  email: string;
  origen: string;
  lineas: { producto: string; metros: number; precio: number; subtotal: number }[];
};

function rango(ref: Date, p: Periodo) {
  return p === "mes"
    ? { desde: startOfMonth(ref), hasta: endOfMonth(ref) }
    : { desde: startOfWeek(ref, { weekStartsOn: 1 }), hasta: endOfWeek(ref, { weekStartsOn: 1 }) };
}

function nombreCliente(seed: string) {
  const nombres = ["Marta López", "Juan García", "Lucía Ruiz", "Pablo Sanz", "Ana Vidal", "Sergio Romero", "Elena Soto", "Iván Cano", "Clara Mora", "Diego Vega"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const n = nombres[h % nombres.length];
  return { nombre: n, email: n.toLowerCase().replace(/[^a-z]/g, ".") + "@mail.com" };
}

function enriquecer(pedidos: PedidoDemo[]): PedidoFila[] {
  return pedidos.map((p, i) => {
    const seed = `${p.fecha.toISOString().slice(0, 10)}-${i}-${p.tienda}`;
    const c = nombreCliente(seed);
    const numero = `${p.tienda.slice(0, 3).toUpperCase()}-${(10000 + i).toString().slice(-4)}-${p.fecha.getMonth() + 1}`;
    const precio = Number((p.bruto / Math.max(p.metros, 0.01)).toFixed(2));
    return {
      ...p,
      numero,
      cliente: c.nombre,
      email: c.email,
      origen: "WooCommerce",
      lineas: [{ producto: p.producto, metros: p.metros, precio, subtotal: p.bruto }],
    };
  });
}

export function PedidosTable({ tienda }: { tienda?: string }) {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [ref, setRef] = useState(new Date());
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState<string>("todos");
  const [tiendaFiltro, setTiendaFiltro] = useState<string>("todas");
  const [expandida, setExpandida] = useState<string | null>(null);

  const { desde, hasta } = rango(ref, periodo);

  const pedidos = useMemo(() => {
    let base = generarPedidosRango(desde, hasta);
    if (tienda) base = base.filter((p) => p.tienda === tienda);
    return enriquecer(base);
  }, [desde, hasta, tienda]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (estado !== "todos" && p.estado !== estado) return false;
      if (!tienda && tiendaFiltro !== "todas" && p.tienda !== tiendaFiltro) return false;
      if (!q) return true;
      return (
        p.cliente.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.numero.toLowerCase().includes(q)
      );
    });
  }, [pedidos, busqueda, estado, tiendaFiltro, tienda]);

  const totalImporte = filtrados.reduce((s, p) => s + p.total, 0);

  function exportar() {
    const filas: (string | number)[][] = [
      ["Fecha", "Nº", "Tienda", "Cliente", "Email", "Estado", "Origen", "Metros", "Bruto", "IVA", "Envío", "Total"],
      ...filtrados.map((p) => [
        format(p.fecha, "yyyy-MM-dd"),
        p.numero,
        p.tienda,
        p.cliente,
        p.email,
        p.estado,
        p.origen,
        p.metros,
        p.bruto,
        p.iva,
        p.envio,
        p.total,
      ]),
    ];
    descargarCSV(`pedidos-${format(desde, "yyyy-MM-dd")}.csv`, filas);
  }

  const tituloPeriodo =
    periodo === "mes"
      ? format(ref, "MMMM yyyy", { locale: es })
      : `Semana ${format(desde, "d MMM", { locale: es })} – ${format(hasta, "d MMM yyyy", { locale: es })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-card overflow-hidden">
          <Button
            variant={periodo === "mes" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setPeriodo("mes")}
          >
            Mes
          </Button>
          <Button
            variant={periodo === "semana" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setPeriodo("semana")}
          >
            Semana
          </Button>
        </div>
        <div className="inline-flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRef(periodo === "mes" ? addMonths(ref, -1) : addWeeks(ref, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] text-center text-sm font-medium capitalize">
            {tituloPeriodo}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setRef(periodo === "mes" ? addMonths(ref, 1) : addWeeks(ref, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRef(new Date())}>
            Hoy
          </Button>
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, email o nº pedido…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="completado">Completado</SelectItem>
              <SelectItem value="procesando">Procesando</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          {!tienda && (
            <Select value={tiendaFiltro} onValueChange={setTiendaFiltro}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tienda" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las tiendas</SelectItem>
                {TIENDAS_DEMO.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {filtrados.length} pedidos · <span className="font-semibold text-foreground">{eur(totalImporte)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Fecha</TableHead>
                <TableHead>Nº</TableHead>
                {!tienda && <TableHead>Tienda</TableHead>}
                <TableHead>Cliente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead className="text-right">Metros</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((p) => {
                const key = p.numero;
                const abierta = expandida === key;
                return (
                  <FilaPedido
                    key={key}
                    pedido={p}
                    abierta={abierta}
                    mostrarTienda={!tienda}
                    onToggle={() => setExpandida(abierta ? null : key)}
                  />
                );
              })}
              {filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={tienda ? 8 : 9} className="text-center py-8 text-muted-foreground">
                    Sin pedidos en este periodo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FilaPedido({
  pedido,
  abierta,
  mostrarTienda,
  onToggle,
}: {
  pedido: PedidoFila;
  abierta: boolean;
  mostrarTienda: boolean;
  onToggle: () => void;
}) {
  const variant =
    pedido.estado === "completado"
      ? "default"
      : pedido.estado === "procesando"
      ? "secondary"
      : "destructive";
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          {abierta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </TableCell>
        <TableCell>{format(pedido.fecha, "dd/MM/yyyy")}</TableCell>
        <TableCell className="font-mono text-xs">{pedido.numero}</TableCell>
        {mostrarTienda && <TableCell>{pedido.tienda}</TableCell>}
        <TableCell>
          <div className="font-medium">{pedido.cliente}</div>
          <div className="text-xs text-muted-foreground">{pedido.email}</div>
        </TableCell>
        <TableCell><Badge variant={variant as any}>{pedido.estado}</Badge></TableCell>
        <TableCell className="text-xs text-muted-foreground">{pedido.origen}</TableCell>
        <TableCell className="text-right">{metros(pedido.metros)}</TableCell>
        <TableCell className="text-right font-semibold">{eur(pedido.total)}</TableCell>
      </TableRow>
      {abierta && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={mostrarTienda ? 8 : 7}>
            <div className="py-2 space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Líneas del pedido
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Metros</TableHead>
                    <TableHead className="text-right">€ / m</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedido.lineas.map((l, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{l.producto}</TableCell>
                      <TableCell className="text-right">{metros(l.metros)}</TableCell>
                      <TableCell className="text-right">{eur(l.precio)}</TableCell>
                      <TableCell className="text-right font-medium">{eur(l.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid grid-cols-3 gap-4 pt-2 text-sm">
                <div><span className="text-muted-foreground">Bruto:</span> <span className="font-medium">{eur(pedido.bruto)}</span></div>
                <div><span className="text-muted-foreground">IVA (21%):</span> <span className="font-medium">{eur(pedido.iva)}</span></div>
                <div><span className="text-muted-foreground">Envío:</span> <span className="font-medium">{eur(pedido.envio)}</span></div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}