import { useFiltrosUrl, usePeriodoUrl } from "@/lib/filtros-url";
import { SelectorPeriodo } from "@/components/filtros/SelectorPeriodo";
import { enRango } from "@/dominio/periodos";
import {
  BarraFiltros,
  CampoBusqueda,
  QuitarFiltros,
  SelectFiltro,
} from "@/components/filtros/Filtros";
import { normalizarTexto } from "@/dominio/clientes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, FileUp, Loader2, PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { eur } from "@/lib/format";
import { revisarCompra, type CompraLeida } from "@/dominio/factura-compra";
import {
  borrarCompra,
  guardarCompra,
  hayLector,
  leerFacturaCompra,
  listCompras,
  registrarCompra,
} from "@/lib/compras.functions";
import { listStock } from "@/lib/textil.functions";
import { leerAjustesGerencia } from "@/lib/gerencia.functions";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { CATEGORIAS_COMPRA, categoriaCompra } from "@/dominio/compras";

/**
 * Las facturas de compra. En modo «textil», las del género que entra en el
 * stock, como siempre. En modo «general», todas: cada una con su categoría,
 * que decide cómo cuenta en Gerencia (ver dominio/compras.ts), su retención
 * y, si es el recibo de un gasto fijo, el gasto al que corresponde.
 */
type Modo = "textil" | "general";

type Revision = {
  compra: CompraLeida;
  asignaciones: (string | null)[];
  lectura: string | null;
  /** Vacía hasta que se elige: no se adivina qué es una factura. */
  categoria: string;
  gasto_id: string | null;
};

const SIN_GASTO = "ninguno";

const COMPRA_VACIA: CompraLeida = {
  proveedor: null,
  nif_proveedor: null,
  numero: null,
  fecha: null,
  base: 0,
  iva: 0,
  irpf: 0,
  total: 0,
  lineas: [],
};

export function PaginaCompras({ modo }: { modo: Modo }) {
  const qc = useQueryClient();
  const ficheroRef = useRef<HTMLInputElement>(null);
  const [revisando, setRevisando] = useState<Revision | null>(null);
  const [borrando, setBorrando] = useState<any>(null);
  const general = modo === "general";

  const listFn = useServerFn(listCompras);
  const { data, isLoading } = useQuery({
    queryKey: ["compras", modo],
    queryFn: () => listFn({ data: { soloTextil: !general } }),
  });
  const compras = useMemo(() => data?.compras ?? [], [data]);
  // Sin la migración de compras generales, solo se puede registrar textil.
  const sinGenerales = general && data?.generales === false;
  const ajustesFn = useServerFn(leerAjustesGerencia);
  const { data: ajustes } = useQuery({
    queryKey: ["gerencia-ajustes"],
    queryFn: () => ajustesFn(),
    enabled: general,
  });
  const gastos = ajustes?.gastos ?? [];
  const nueva = (compra: CompraLeida, lectura: string | null): Revision => ({
    compra,
    asignaciones: compra.lineas.map(() => null),
    lectura,
    categoria: general ? "" : "textil",
    gasto_id: null,
  });
  // Los filtros viven en la dirección.
  const {
    valores: filtros,
    cambiar,
    quitar,
    hay,
  } = useFiltrosUrl({
    q: "",
    estado: "todos",
    categoria: "todas",
  });
  // Por defecto, todo: la lista se abre como siempre.
  const periodo = usePeriodoUrl("todo");
  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return (compras as any[]).filter(
      (c) =>
        enRango(c.fecha, periodo.rango) &&
        (filtros.estado === "todos" || c.estado === filtros.estado) &&
        (filtros.categoria === "todas" || (c.categoria ?? "textil") === filtros.categoria) &&
        (!q || normalizarTexto(c.proveedor).includes(q) || normalizarTexto(c.numero).includes(q)),
    );
  }, [compras, filtros.q, filtros.estado, filtros.categoria, periodo.rango]);

  const stockFn = useServerFn(listStock);
  const { data: stock = [] } = useQuery({ queryKey: ["textil-stock"], queryFn: () => stockFn() });

  const lectorFn = useServerFn(hayLector);
  const { data: lector } = useQuery({ queryKey: ["hay-lector"], queryFn: () => lectorFn() });

  const leerFn = useServerFn(leerFacturaCompra);
  const leer = useMutation({
    mutationFn: (fichero: File) => {
      const fd = new FormData();
      fd.append("fichero", fichero);
      return leerFn({ data: fd });
    },
    onSuccess: (r: any) => {
      setRevisando(nueva(r.compra, r.bruto_json ?? null));
      if (r.avisos.length > 0) {
        toast.warning(`Leída con ${r.avisos.length} cosa(s) que revisar`);
      } else {
        toast.success("Factura leída. Revísala antes de registrarla.");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo leer la factura"),
  });

  const registrarFn = useServerFn(registrarCompra);
  const guardarFn = useServerFn(guardarCompra);
  const registrar = useMutation({
    mutationFn: async () => {
      if (!revisando) throw new Error("Nada que registrar");
      const { irpf, ...compra } = revisando.compra;
      const { id } = (await guardarFn({
        data: {
          ...compra,
          // Las columnas nuevas solo se mandan desde la pantalla general.
          ...(general
            ? { irpf, categoria: revisando.categoria, gasto_id: revisando.gasto_id }
            : {}),
          lectura_ia: revisando.lectura,
          lineas: revisando.compra.lineas.map((l, i) => ({
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            importe: l.importe,
            unidad: l.unidad ?? null,
            stock_id: revisando.categoria === "textil" ? revisando.asignaciones[i] : null,
          })),
        },
      })) as { id: string };
      return registrarFn({ data: { id } });
    },
    onSuccess: (r: any) => {
      toast.success(
        r.movidas > 0 ? `${r.movidas} línea(s) dadas de alta en el stock` : "Factura registrada",
      );
      setRevisando(null);
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["gerencia-compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo registrar la compra"),
  });

  const borrarFn = useServerFn(borrarCompra);
  const borrar = useMutation({
    mutationFn: (id: string) => borrarFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Compra borrada");
      setBorrando(null);
      qc.invalidateQueries({ queryKey: ["compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo borrar"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {general ? "Facturas de compra" : "Compras"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {general
              ? "Las facturas de tus proveedores: tinta, film, mensajería, máquinas, servicios… Cada una cuenta en Gerencia según lo que sea, y su IVA va al 303."
              : "Sube la factura del proveedor y da el género de alta en el stock."}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={ficheroRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) leer.mutate(f);
            }}
          />
          <Button
            onClick={() => ficheroRef.current?.click()}
            disabled={leer.isPending || lector?.disponible === false || sinGenerales}
          >
            {leer.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4 mr-2" />
            )}
            {leer.isPending ? "Leyendo…" : "Subir factura"}
          </Button>
          <Button
            variant="outline"
            disabled={sinGenerales}
            onClick={() => setRevisando(nueva({ ...COMPRA_VACIA }, null))}
          >
            A mano
          </Button>
        </div>
      </div>

      {lector?.disponible === false && (
        <Card className="border-amber-500/50">
          <CardContent className="flex gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">El lector de facturas no está configurado.</p>
              <p className="text-muted-foreground">
                Falta la variable <span className="font-mono">ANTHROPIC_API_KEY</span> en el entorno
                del despliegue. Mientras tanto puedes dar las compras de alta a mano.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {sinGenerales && (
        <Card className="border-amber-500/50">
          <CardContent className="flex gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              Falta aplicar la migración de compras generales (20261013100000). Hasta entonces, las
              compras de textil se registran en Textil › Compras.
            </p>
          </CardContent>
        </Card>
      )}

      <BarraFiltros>
        <CampoBusqueda
          valor={filtros.q}
          alCambiar={(q) => cambiar({ q })}
          placeholder="Buscar proveedor o nº de factura…"
        />
        <SelectFiltro
          etiqueta="Estado"
          valor={filtros.estado}
          alCambiar={(estado) => cambiar({ estado })}
          opciones={[
            { valor: "todos", etiqueta: "Todos los estados" },
            ...[...new Set((compras as any[]).map((c) => String(c.estado)))]
              .sort()
              .map((e) => ({ valor: e, etiqueta: e })),
          ]}
        />
        {general && (
          <SelectFiltro
            etiqueta="Categoría"
            valor={filtros.categoria}
            alCambiar={(categoria) => cambiar({ categoria })}
            opciones={[
              { valor: "todas", etiqueta: "Todas las categorías" },
              ...CATEGORIAS_COMPRA.map((c) => ({ valor: c.valor, etiqueta: c.etiqueta })),
            ]}
          />
        )}
        <SelectorPeriodo periodo={periodo} />
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
      </BarraFiltros>
      <Card>
        <CardContent className="p-0">
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                {general && <TableHead>Categoría</TableHead>}
                <TableHead>Número</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={general ? 8 : 7}>Cargando…</TableCell>
                </TableRow>
              )}
              {!isLoading && compras.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={general ? 8 : 7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Sin compras registradas.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell>{c.fecha ?? "—"}</TableCell>
                  <TableCell className="font-medium">{c.proveedor ?? "—"}</TableCell>
                  {general && (
                    <TableCell>
                      {categoriaCompra(c.categoria).etiqueta}
                      {c.gasto_id && (
                        <span className="block text-xs text-muted-foreground">
                          Recibo de «
                          {gastos.find((g) => g.id === c.gasto_id)?.concepto ?? "un gasto fijo"}»
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs">{c.numero ?? "—"}</TableCell>
                  <TableCell className="text-right">{eur(Number(c.base))}</TableCell>
                  <TableCell className="text-right font-medium">{eur(Number(c.total))}</TableCell>
                  <TableCell>
                    <Badge variant={c.estado === "registrada" ? "default" : "outline"}>
                      {c.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.estado === "borrador" && (
                      <Button variant="ghost" size="icon" onClick={() => setBorrando(c)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmarBorrado
        abierto={!!borrando}
        onCerrar={() => setBorrando(null)}
        que={`la compra ${borrando?.numero ?? ""}`}
        consecuencias={["Es un borrador: no ha tocado el stock."]}
        cargando={borrar.isPending}
        onConfirmar={() => borrando && borrar.mutate(borrando.id)}
      />

      <Dialog open={!!revisando} onOpenChange={(o) => !o && setRevisando(null)}>
        {revisando && (
          <RevisarCompra
            modo={modo}
            estado={revisando}
            gastos={gastos}
            stock={stock}
            onCambiar={setRevisando}
            onRegistrar={() => registrar.mutate()}
            registrando={registrar.isPending}
          />
        )}
      </Dialog>
    </div>
  );
}

/**
 * La pantalla de revisión.
 *
 * Existe porque la lectura de un modelo NO es un dato: es una propuesta. Los
 * movimientos de stock no se borran, así que un «12» leído como «120» quedaría
 * anotado para siempre. Aquí se comprueba y se casa cada línea con una variante
 * del catálogo antes de que entre nada.
 */
function RevisarCompra({
  modo,
  estado,
  gastos,
  stock,
  onCambiar,
  onRegistrar,
  registrando,
}: {
  modo: Modo;
  estado: Revision;
  gastos: { id: string; concepto: string }[];
  stock: any[];
  onCambiar: (e: Revision) => void;
  onRegistrar: () => void;
  registrando: boolean;
}) {
  const { compra, asignaciones } = estado;
  const general = modo === "general";
  const esTextil = estado.categoria === "textil";
  const avisos = revisarCompra(compra);
  const sinCasar = esTextil ? compra.lineas.filter((_, i) => !asignaciones[i]).length : 0;
  // Sin categoría no se sabe cómo cuenta: no se registra.
  const sinCategoria = !estado.categoria;
  const bloqueada = esTextil ? compra.lineas.length === 0 || sinCasar > 0 : sinCategoria;

  const set = (cambios: Partial<CompraLeida>) =>
    onCambiar({ ...estado, compra: { ...compra, ...cambios } });

  const setLinea = (i: number, cambios: any) =>
    set({ lineas: compra.lineas.map((l, j) => (i === j ? { ...l, ...cambios } : l)) });

  const setAsignacion = (i: number, valor: string | null) =>
    onCambiar({
      ...estado,
      asignaciones: asignaciones.map((a, j) => (i === j ? valor : a)),
    });

  return (
    <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {general
            ? "Revisar la factura antes de registrarla"
            : "Revisar la compra antes de darla de alta"}
        </DialogTitle>
        <DialogDescription>
          {esTextil
            ? "Lo que se registre entra en el libro de stock y no se puede borrar. Comprueba las cantidades y di a qué artículo del catálogo corresponde cada línea."
            : "Comprueba los importes y di qué es: de eso depende cómo cuenta en Gerencia. Una factura registrada no se borra."}
        </DialogDescription>
      </DialogHeader>

      {avisos.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Los números no cuadran entre sí
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            {avisos.map((a, i) => (
              <div key={i}>
                {a.linea !== null && <span className="font-medium">Línea {a.linea + 1}: </span>}
                {a.mensaje}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {general && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Qué es</Label>
            <Select
              value={estado.categoria}
              onValueChange={(categoria) =>
                onCambiar({
                  ...estado,
                  categoria,
                  // El textil va al stock: no es el recibo de un gasto fijo.
                  gasto_id: categoria === "textil" ? null : estado.gasto_id,
                })
              }
            >
              <SelectTrigger className={sinCategoria ? "border-amber-500" : ""}>
                <SelectValue placeholder="Elige la categoría" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIAS_COMPRA.map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    {c.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!sinCategoria && (
              <p className="text-xs text-muted-foreground">{explicarTrato(estado.categoria)}</p>
            )}
          </div>
          {!sinCategoria && !esTextil && (
            <div className="space-y-1.5">
              <Label className="text-xs">¿Es el recibo de un gasto fijo?</Label>
              <Select
                value={estado.gasto_id ?? SIN_GASTO}
                onValueChange={(v) =>
                  onCambiar({ ...estado, gasto_id: v === SIN_GASTO ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_GASTO}>No, es una compra suelta</SelectItem>
                  {gastos.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.concepto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {estado.gasto_id && (
                <p className="text-xs text-muted-foreground">
                  Ese mes (o trimestre) cuenta esta factura en vez de la estimación del gasto.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Campo
          etiqueta="Proveedor"
          valor={compra.proveedor ?? ""}
          onChange={(v) => set({ proveedor: v || null })}
        />
        <Campo
          etiqueta="NIF"
          valor={compra.nif_proveedor ?? ""}
          onChange={(v) => set({ nif_proveedor: v || null })}
        />
        <Campo
          etiqueta="Número"
          valor={compra.numero ?? ""}
          onChange={(v) => set({ numero: v || null })}
        />
        <Campo
          etiqueta="Fecha"
          tipo="date"
          valor={compra.fecha ?? ""}
          onChange={(v) => set({ fecha: v || null })}
        />
      </div>

      <Table movil="tarjetas">
        <TableHeader>
          <TableRow>
            <TableHead>Concepto</TableHead>
            <TableHead className="w-24 text-right">Cantidad</TableHead>
            <TableHead className="w-28 text-right">Coste ud.</TableHead>
            <TableHead className="w-28 text-right">Importe</TableHead>
            {esTextil && <TableHead className="w-64">Artículo del catálogo</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {compra.lineas.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={esTextil ? 5 : 4}
                className="text-center py-6 text-muted-foreground"
              >
                {esTextil
                  ? "Sin líneas. Añade una para dar género de alta."
                  : "Sin líneas. No hacen falta: cuentan la base, el IVA y el total."}
              </TableCell>
            </TableRow>
          )}
          {compra.lineas.map((l, i) => (
            <TableRow key={i}>
              <TableCell>
                <Input
                  value={l.descripcion}
                  onChange={(e) => setLinea(i, { descripcion: e.target.value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="any"
                  className="text-right"
                  value={l.cantidad}
                  onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="any"
                  className="text-right"
                  value={l.precio_unitario}
                  onChange={(e) => setLinea(i, { precio_unitario: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {eur(Number(l.importe))}
              </TableCell>
              {esTextil && (
                <TableCell>
                  <Select
                    value={asignaciones[i] ?? ""}
                    onValueChange={(v) => setAsignacion(i, v || null)}
                  >
                    <SelectTrigger className={asignaciones[i] ? "" : "border-amber-500"}>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      {stock.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>
                          {[s.nombre, s.color, s.talla].filter(Boolean).join(" · ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          onCambiar({
            ...estado,
            compra: {
              ...compra,
              lineas: [
                ...compra.lineas,
                { descripcion: "", cantidad: 1, precio_unitario: 0, importe: 0, unidad: null },
              ],
            },
            asignaciones: [...asignaciones, null],
          })
        }
      >
        Añadir línea
      </Button>

      <div className={`grid gap-3 ${general ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
        <Campo
          etiqueta="Base"
          tipo="number"
          valor={String(compra.base)}
          onChange={(v) => set({ base: Number(v) })}
        />
        <Campo
          etiqueta="IVA"
          tipo="number"
          valor={String(compra.iva)}
          onChange={(v) => set({ iva: Number(v) })}
        />
        {general && (
          <Campo
            etiqueta="IRPF retenido"
            tipo="number"
            valor={String(compra.irpf)}
            onChange={(v) => set({ irpf: Number(v) })}
          />
        )}
        <Campo
          etiqueta="Total"
          tipo="number"
          valor={String(compra.total)}
          onChange={(v) => set({ total: Number(v) })}
        />
      </div>

      <DialogFooter className="items-center gap-3">
        {sinCasar > 0 && (
          <span className="text-sm text-muted-foreground mr-auto">
            {sinCasar} línea(s) sin asignar a un artículo.
          </span>
        )}
        {sinCategoria && (
          <span className="text-sm text-muted-foreground mr-auto">
            Elige qué es antes de registrarla.
          </span>
        )}
        <Button onClick={onRegistrar} disabled={registrando || bloqueada}>
          {registrando ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <PackageCheck className="h-4 w-4 mr-2" />
          )}
          {esTextil ? "Dar de alta en el stock" : "Registrar factura"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Cómo cuenta en Gerencia una factura de esa categoría, en una línea. */
function explicarTrato(categoria: string): string {
  const c = categoriaCompra(categoria);
  switch (c.trato) {
    case "stock":
      return "Entra en el stock; cuesta cuando se vende la prenda.";
    case "comparar":
      return "Su IVA va al 303. Ya cuesta en cada pedido (por metro o por envío): Gerencia lo compara.";
    case "amortizar":
      return `Su IVA va al 303 entero. Al resultado va un ${c.amortizacion} % al año (amortización).`;
    default:
      return "Su IVA va al 303 y cuesta entera el día de la factura.";
  }
}

function Campo({
  etiqueta,
  valor,
  onChange,
  tipo = "text",
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{etiqueta}</Label>
      <Input
        type={tipo}
        step={tipo === "number" ? "any" : undefined}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
