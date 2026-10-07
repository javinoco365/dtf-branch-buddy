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
import { eur, fechaCorta } from "@/lib/format";
import { revisarCompra, type CompraLeida } from "@/dominio/factura-compra";
import {
  borrarCompra,
  guardarCompra,
  hayLector,
  leerFacturaCompra,
  listCompras,
  pagarCompra,
  registrarCompra,
} from "@/lib/compras.functions";
import { listStock } from "@/lib/textil.functions";
import { leerAjustesGerencia } from "@/lib/gerencia.functions";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { SubidaFacturas } from "./SubidaFacturas";
import { ColaRevision } from "./ColaRevision";
import {
  avisoDuplicado,
  avisosQueImportan,
  bloqueaRegistro,
  duplicadosDe,
} from "@/dominio/cola-compras";
import {
  calcularCompra,
  CATEGORIAS_COMPRA,
  categoriaCompra,
  descuadreLiquido,
  FORMAS_PAGO,
  tipoIrpfProbable,
  tipoProbable,
} from "@/dominio/compras";

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
  /** En tanto por uno. Nulo si la cuota leída no la explica ningún tipo: se elige. */
  tipo_iva: number | null;
  tipo_irpf: number;
  /** Si el líquido no cuadra, cuál vale. Nulo hasta que se elige. */
  origen: "calculado" | "factura" | null;
  nota: string;
  concepto: string;
  forma_pago: string | null;
  /** Si viene de la cola: la fila que se confirma, y por qué había que mirarla. */
  id?: string;
  motivos?: string | null;
  fichero_huella?: string | null;
  /** Confirmado que no es un duplicado (mismo proveedor, fecha e importe). */
  otraFactura?: boolean;
};

/** Está en la cola: la leyó la IA y nadie la ha confirmado, o no se pudo leer. */
const enCola = (c: any) => c.revision === "pendiente" || c.revision === "error";
const anioDe = (c: any): string => String(c.ejercicio ?? c.fecha?.slice(0, 4) ?? "");
const trimestreDe = (c: any): string =>
  String(c.trimestre ?? (c.fecha ? Math.floor((Number(c.fecha.slice(5, 7)) - 1) / 3) + 1 : ""));

const SIN_GASTO = "ninguno";
const SIN_FORMA = "sin_forma";
const TIPOS_IVA = [0.21, 0.1, 0.04, 0];
const TIPOS_IRPF = [0, 0.07, 0.15, 0.19];
const porcentaje = (t: number) => `${Math.round(t * 100)} %`;
/** Una compra borrada (borrado lógico) se enseña con ese estado. */
const estadoDe = (c: any): string => (c.borrada_en ? "borrada" : String(c.estado));

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
  const [pagando, setPagando] = useState<{ compra: any; fecha: string } | null>(null);
  const general = modo === "general";

  const listFn = useServerFn(listCompras);
  const { data, isLoading } = useQuery({
    queryKey: ["compras", modo],
    queryFn: () => listFn({ data: { soloTextil: !general } }),
  });
  const compras = useMemo(() => data?.compras ?? [], [data]);
  // Sin la migración de compras generales, solo se puede registrar textil.
  const sinGenerales = general && data?.generales === false;
  // Con la migración de facturas recibidas, la base calcula los importes.
  const recibidas = data?.recibidas === true;
  // Con la migración de la cola: subir varias, revisarlas y avisar de duplicados.
  const cola = general && data?.cola === true;
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
    // Una factura a mano empieza al 21 %; una leída, con el tipo que explica su IVA.
    tipo_iva: compra.base > 0 ? tipoProbable(compra.base, compra.iva) : 0.21,
    tipo_irpf: (compra.base > 0 && tipoIrpfProbable(compra.base, compra.irpf)) || 0,
    origen: null,
    nota: "",
    concepto: "",
    forma_pago: null,
  });
  /** Una factura de la cola, para revisarla con lo que leyó la IA. */
  const desdeFila = (c: any): Revision => {
    const compra: CompraLeida = {
      proveedor: c.proveedor ?? null,
      nif_proveedor: c.nif_proveedor ?? null,
      numero: c.numero ?? null,
      fecha: c.fecha ?? null,
      base: Number(c.base ?? 0),
      iva: Number(c.iva ?? 0),
      irpf: Number(c.irpf ?? 0),
      total: Number(c.total ?? 0),
      lineas: (c.lineas ?? [])
        .slice()
        .sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0))
        .map((l: any) => ({
          descripcion: l.descripcion,
          cantidad: Number(l.cantidad),
          precio_unitario: Number(l.precio_unitario),
          importe: Number(l.importe),
          unidad: l.unidad ?? null,
        })),
    };
    return {
      ...nueva(compra, null),
      id: c.id,
      categoria: c.categoria ?? "",
      gasto_id: c.gasto_id ?? null,
      // Si la cuota leída no la explica ningún tipo, que se elija a mano.
      tipo_iva: compra.base > 0 ? tipoProbable(compra.base, compra.iva) : 0.21,
      tipo_irpf: Number(c.tipo_irpf ?? 0),
      concepto: c.concepto ?? "",
      forma_pago: c.forma_pago ?? null,
      motivos: c.revision_motivo ?? null,
      fichero_huella: c.fichero_huella ?? null,
      otraFactura: false,
    };
  };
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
    anio: "todos",
    trimestre: "todos",
    proveedor: "todos",
  });
  // Por defecto, todo: la lista se abre como siempre.
  const periodo = usePeriodoUrl("todo");
  const filtrados = useMemo(() => {
    const q = normalizarTexto(filtros.q);
    return (compras as any[]).filter(
      (c) =>
        // Lo que está en la cola se ve en «Por revisar», no aquí.
        !(cola && enCola(c)) &&
        enRango(c.fecha, periodo.rango) &&
        (filtros.anio === "todos" || anioDe(c) === filtros.anio) &&
        (filtros.trimestre === "todos" || trimestreDe(c) === filtros.trimestre) &&
        (filtros.proveedor === "todos" || (c.proveedor ?? "") === filtros.proveedor) &&
        // Las borradas solo se ven si se piden.
        (filtros.estado === "todos" ? !c.borrada_en : estadoDe(c) === filtros.estado) &&
        (filtros.categoria === "todas" || (c.categoria ?? "textil") === filtros.categoria) &&
        (!q || normalizarTexto(c.proveedor).includes(q) || normalizarTexto(c.numero).includes(q)),
    );
  }, [
    compras,
    cola,
    filtros.q,
    filtros.estado,
    filtros.categoria,
    filtros.anio,
    filtros.trimestre,
    filtros.proveedor,
    periodo.rango,
  ]);
  const enLaCola = useMemo(
    () => (cola ? (compras as any[]).filter((c) => enCola(c) && !c.borrada_en) : []),
    [compras, cola],
  );
  const anios = useMemo(
    () => [...new Set((compras as any[]).map(anioDe).filter(Boolean))].sort().reverse(),
    [compras],
  );
  const proveedores = useMemo(
    () =>
      [...new Set((compras as any[]).map((c) => c.proveedor).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, "es"),
      ),
    [compras],
  );

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
      const calculado = calcularCompra({
        base: compra.base,
        tipo_iva: revisando.tipo_iva ?? 0.21,
        tipo_irpf: revisando.tipo_irpf,
      });
      const descuadre = descuadreLiquido(calculado.liquido, compra.total) !== null;
      const { id } = (await guardarFn({
        data: {
          ...compra,
          // De la cola: se confirma la fila que leyó la IA.
          ...(revisando.id ? { id: revisando.id } : {}),
          ...(revisando.otraFactura
            ? { notas: "Confirmada como factura distinta (mismo proveedor, fecha e importe)." }
            : {}),
          // Las columnas nuevas solo se mandan desde la pantalla general.
          ...(general
            ? { irpf, categoria: revisando.categoria, gasto_id: revisando.gasto_id }
            : {}),
          // Los tipos, con la migración de facturas recibidas: la base calcula
          // los importes con ellos.
          ...(recibidas
            ? {
                tipo_iva: revisando.tipo_iva ?? 0.21,
                tipo_irpf: revisando.tipo_irpf,
                ...(general
                  ? {
                      liquido_origen:
                        descuadre && revisando.origen === "factura"
                          ? ("factura" as const)
                          : ("calculado" as const),
                      nota_descuadre:
                        descuadre && revisando.origen === "factura" ? revisando.nota : null,
                      concepto: revisando.concepto || null,
                      forma_pago: revisando.forma_pago,
                    }
                  : {}),
              }
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
    onSuccess: (r: any) => {
      toast.success(r?.logico ? "Factura marcada como borrada" : "Compra borrada");
      setBorrando(null);
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["gerencia-compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo borrar"),
  });

  const pagarFn = useServerFn(pagarCompra);
  const pagar = useMutation({
    mutationFn: (v: { id: string; fecha_pago: string | null }) => pagarFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.fecha_pago ? "Marcada como pagada" : "Vuelve a estar pendiente de pago");
      setPagando(null);
      qc.invalidateQueries({ queryKey: ["compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo cambiar el pago"),
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
          {!cola && (
            <>
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
            </>
          )}
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
                Falta el secreto <span className="font-mono">facturas_key</span> en el Vault de
                Supabase. Mientras tanto puedes dar las compras de alta a mano.
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

      {cola && (
        <SubidaFacturas
          deshabilitado={lector?.disponible === false}
          alTerminarUna={() => qc.invalidateQueries({ queryKey: ["compras"] })}
        />
      )}
      {cola && (
        <ColaRevision
          compras={enLaCola}
          onRevisar={(c) => setRevisando(desdeFila(c))}
          onBorrar={(c) => setBorrando(c)}
        />
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
            ...[...new Set((compras as any[]).map(estadoDe))]
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
        {general && (
          <SelectFiltro
            etiqueta="Año"
            valor={filtros.anio}
            alCambiar={(anio) => cambiar({ anio })}
            opciones={[
              { valor: "todos", etiqueta: "Todos los años" },
              ...anios.map((a) => ({ valor: a, etiqueta: a })),
            ]}
            ancho="w-[140px]"
          />
        )}
        {general && (
          <SelectFiltro
            etiqueta="Trimestre"
            valor={filtros.trimestre}
            alCambiar={(trimestre) => cambiar({ trimestre })}
            opciones={[
              { valor: "todos", etiqueta: "Todos los trimestres" },
              ...["1", "2", "3", "4"].map((t) => ({ valor: t, etiqueta: `${t}.º trimestre` })),
            ]}
            ancho="w-[170px]"
          />
        )}
        {general && (
          <SelectFiltro
            etiqueta="Proveedor"
            valor={filtros.proveedor}
            alCambiar={(proveedor) => cambiar({ proveedor })}
            opciones={[
              { valor: "todos", etiqueta: "Todos los proveedores" },
              ...proveedores.map((p) => ({ valor: p, etiqueta: p })),
            ]}
            ancho="w-[220px] max-md:w-full"
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
                <TableHead className="text-right">
                  {general && recibidas ? "Líquido" : "Total"}
                </TableHead>
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
                  <TableCell className="text-right font-medium">
                    {eur(Number(c.liquido ?? c.total))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={estadoDe(c) === "registrada" ? "default" : "outline"}>
                      {estadoDe(c)}
                    </Badge>
                    {general && c.estado_pago === "pagada" && !c.borrada_en && (
                      <span className="block text-xs text-muted-foreground">
                        Pagada el {fechaCorta(c.fecha_pago)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      {general &&
                        recibidas &&
                        c.estado === "registrada" &&
                        !c.borrada_en &&
                        (c.estado_pago === "pagada" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            disabled={pagar.isPending}
                            onClick={() => pagar.mutate({ id: c.id, fecha_pago: null })}
                          >
                            Pendiente
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() =>
                              setPagando({
                                compra: c,
                                fecha: new Date().toISOString().slice(0, 10),
                              })
                            }
                          >
                            Pagada
                          </Button>
                        ))}
                      {(c.estado === "borrador" ||
                        (general &&
                          recibidas &&
                          !c.borrada_en &&
                          (c.categoria ?? "textil") !== "textil")) && (
                        <Button variant="ghost" size="icon" onClick={() => setBorrando(c)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
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
        consecuencias={
          borrando && enCola(borrando)
            ? ["No ha contado en ningún sitio: sale de la cola."]
            : borrando?.estado === "registrada"
              ? [
                  "Queda marcada como borrada: deja de contar en Gerencia, en el IVA y en el banco.",
                  "No desaparece: se ve con el filtro «borrada».",
                ]
              : ["Es un borrador: no ha tocado el stock."]
        }
        cargando={borrar.isPending}
        onConfirmar={() => borrando && borrar.mutate(borrando.id)}
      />

      <Dialog open={!!pagando} onOpenChange={(o) => !o && setPagando(null)}>
        {pagando && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Marcar como pagada</DialogTitle>
              <DialogDescription>
                {pagando.compra.proveedor ?? "Factura"} {pagando.compra.numero ?? ""} ·{" "}
                {eur(Number(pagando.compra.liquido ?? pagando.compra.total))}
              </DialogDescription>
            </DialogHeader>
            <Campo
              etiqueta="Fecha de pago"
              tipo="date"
              valor={pagando.fecha}
              onChange={(fecha) => setPagando({ ...pagando, fecha })}
            />
            <DialogFooter>
              <Button
                disabled={!pagando.fecha || pagar.isPending}
                onClick={() => pagar.mutate({ id: pagando.compra.id, fecha_pago: pagando.fecha })}
              >
                Marcar pagada
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!revisando} onOpenChange={(o) => !o && setRevisando(null)}>
        {revisando && (
          <RevisarCompra
            modo={modo}
            conTipos={recibidas}
            todas={cola ? compras : []}
            onDescartar={() => {
              const fila = compras.find((c: any) => c.id === revisando.id);
              setRevisando(null);
              if (fila) setBorrando(fila);
            }}
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
  conTipos,
  todas,
  onDescartar,
  estado,
  gastos,
  stock,
  onCambiar,
  onRegistrar,
  registrando,
}: {
  modo: Modo;
  /** Con la migración de facturas recibidas: tipos, cálculo y descuadre. */
  conTipos: boolean;
  /** Todas las compras, para avisar de duplicados (vacío sin la cola). */
  todas: any[];
  /** Descartar la factura de la cola (es un duplicado). */
  onDescartar: () => void;
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
  const avisos = avisosQueImportan(revisarCompra(compra), estado.categoria);
  const sinCasar = esTextil ? compra.lineas.filter((_, i) => !asignaciones[i]).length : 0;
  // Sin categoría no se sabe cómo cuenta: no se registra.
  const sinCategoria = !estado.categoria;
  // Lo que calculará la base con estos tipos, para verlo antes de guardar.
  const conCalculo = general && conTipos;
  const calculado = calcularCompra({
    base: compra.base,
    tipo_iva: estado.tipo_iva ?? 0,
    tipo_irpf: estado.tipo_irpf,
  });
  const descuadre = conCalculo ? descuadreLiquido(calculado.liquido, compra.total) : null;
  // Un descuadre se resuelve eligiendo cuál vale; si vale la factura, diciendo por qué.
  const descuadreSinResolver =
    descuadre !== null &&
    (estado.origen === null || (estado.origen === "factura" && !estado.nota.trim()));
  // Duplicados: la misma factura registrada impide registrar; un posible
  // duplicado (o una copia en la cola) hay que confirmarlo.
  const duplicados =
    todas.length > 0
      ? duplicadosDe(
          {
            id: estado.id,
            proveedor: compra.proveedor,
            nif_proveedor: compra.nif_proveedor,
            numero: compra.numero,
            fecha: compra.fecha,
            liquido: conCalculo ? calculado.liquido : compra.total,
            fichero_huella: estado.fichero_huella,
          },
          todas,
        )
      : [];
  const duplicadoQueBloquea = duplicados.find(bloqueaRegistro);
  const porConfirmar = duplicados.filter((d) => !bloqueaRegistro(d) && !d.borrada);
  const bloqueada =
    !!duplicadoQueBloquea ||
    (porConfirmar.length > 0 && !estado.otraFactura) ||
    (esTextil
      ? compra.lineas.length === 0 || sinCasar > 0
      : sinCategoria || (conCalculo && (estado.tipo_iva === null || descuadreSinResolver)));

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

      {(estado.motivos || duplicados.length > 0) && (
        <Card className={duplicadoQueBloquea ? "border-destructive/60" : "border-amber-500/50"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Qué mirar antes de registrarla
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {duplicados.map((d, i) => (
              <p
                key={`d${i}`}
                className={bloqueaRegistro(d) ? "font-medium text-destructive" : "font-medium"}
              >
                {avisoDuplicado(d)}
                {bloqueaRegistro(d) && " No se puede registrar dos veces."}
              </p>
            ))}
            {String(estado.motivos ?? "")
              .split("\n")
              .filter((m) => m && !m.startsWith("Este fichero") && !m.startsWith("Esta factura"))
              .filter((m) => !m.startsWith("Posible duplicado"))
              .map((m, i) => (
                <p key={i} className="text-muted-foreground">
                  {m}
                </p>
              ))}
            {duplicados.length > 0 && estado.id && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="button" size="sm" variant="outline" onClick={onDescartar}>
                  Es la misma: descartar
                </Button>
                {porConfirmar.length > 0 && !duplicadoQueBloquea && (
                  <Button
                    type="button"
                    size="sm"
                    variant={estado.otraFactura ? "default" : "outline"}
                    onClick={() => onCambiar({ ...estado, otraFactura: !estado.otraFactura })}
                  >
                    Es otra factura
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {conCalculo ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Campo
              etiqueta="Base imponible"
              tipo="number"
              valor={String(compra.base)}
              onChange={(v) => set({ base: Number(v) })}
            />
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de IVA</Label>
              <Select
                value={estado.tipo_iva === null ? "" : String(estado.tipo_iva)}
                onValueChange={(v) => onCambiar({ ...estado, tipo_iva: Number(v) })}
              >
                <SelectTrigger className={estado.tipo_iva === null ? "border-amber-500" : ""}>
                  <SelectValue placeholder="Elige el tipo" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_IVA.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {porcentaje(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de IRPF</Label>
              <Select
                value={String(estado.tipo_irpf)}
                onValueChange={(v) => onCambiar({ ...estado, tipo_irpf: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_IRPF.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {porcentaje(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Campo
              etiqueta="IVA según la factura"
              tipo="number"
              valor={String(compra.iva)}
              onChange={(v) => set({ iva: Number(v) })}
            />
            <Campo
              etiqueta="IRPF según la factura"
              tipo="number"
              valor={String(compra.irpf)}
              onChange={(v) => set({ irpf: Number(v) })}
            />
            <Campo
              etiqueta="A pagar según la factura"
              tipo="number"
              valor={String(compra.total)}
              onChange={(v) => set({ total: Number(v) })}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            La base calculará: IVA {eur(calculado.cuotaIva)} · IRPF {eur(calculado.cuotaIrpf)} ·
            total {eur(calculado.total)} ·{" "}
            <span className="font-medium text-foreground">líquido {eur(calculado.liquido)}</span>
          </p>
          {descuadre !== null && (
            <Card className="border-amber-500/50">
              <CardContent className="space-y-3 py-4 text-sm">
                <p className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  La factura dice {eur(compra.total)} a pagar y el cálculo da{" "}
                  {eur(calculado.liquido)} ({descuadre > 0 ? "+" : ""}
                  {eur(descuadre)}). ¿Cuál vale?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={estado.origen === "calculado" ? "default" : "outline"}
                    onClick={() => onCambiar({ ...estado, origen: "calculado" })}
                  >
                    El calculado ({eur(calculado.liquido)})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={estado.origen === "factura" ? "default" : "outline"}
                    onClick={() => onCambiar({ ...estado, origen: "factura" })}
                  >
                    El de la factura ({eur(compra.total)})
                  </Button>
                </div>
                {estado.origen === "factura" && (
                  <Campo
                    etiqueta="Por qué no cuadra (obligatorio)"
                    valor={estado.nota}
                    onChange={(nota) => onCambiar({ ...estado, nota })}
                  />
                )}
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Campo
              etiqueta="Concepto"
              valor={estado.concepto}
              onChange={(concepto) => onCambiar({ ...estado, concepto })}
            />
            <div className="space-y-1.5">
              <Label className="text-xs">Forma de pago</Label>
              <Select
                value={estado.forma_pago ?? SIN_FORMA}
                onValueChange={(v) =>
                  onCambiar({ ...estado, forma_pago: v === SIN_FORMA ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_FORMA}>Sin indicar</SelectItem>
                  {FORMAS_PAGO.map((f) => (
                    <SelectItem key={f.valor} value={f.valor}>
                      {f.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ) : (
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
      )}

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
        {!sinCategoria && conCalculo && estado.tipo_iva === null && (
          <span className="text-sm text-muted-foreground mr-auto">Elige el tipo de IVA.</span>
        )}
        {duplicadoQueBloquea && (
          <span className="text-sm text-destructive mr-auto">Ya está registrada.</span>
        )}
        {!duplicadoQueBloquea && porConfirmar.length > 0 && !estado.otraFactura && (
          <span className="text-sm text-muted-foreground mr-auto">
            ¿Es un duplicado? Descártala o confirma que es otra factura.
          </span>
        )}
        {!sinCategoria && descuadreSinResolver && (
          <span className="text-sm text-muted-foreground mr-auto">
            El líquido no cuadra: elige cuál vale.
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
