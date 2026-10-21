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
import { Fragment, useMemo, useRef, useState } from "react";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  FileText,
  FileUp,
  Loader2,
  PackageCheck,
  Paperclip,
  Trash2,
  Users,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { eur, fechaCorta } from "@/lib/format";
import { revisarCompra, type CompraLeida } from "@/dominio/factura-compra";
import {
  adjuntarFicheroCompra,
  borrarCompra,
  guardarYRegistrarCompra,
  hayLector,
  leerFacturaCompra,
  listCompras,
  pagarCompra,
  verCompra,
  verFicheroCompra,
} from "@/lib/compras.functions";
import { guardarProveedor, listProveedores } from "@/lib/escaner-textil.functions";
import {
  AVISO_MIGRACION_ESCANER,
  AVISO_MIGRACION_PROFORMAS,
  lineaDesdeFila,
  lineaEnvioSimple,
} from "@/lib/escaner-textil";
import { listStock } from "@/lib/textil.functions";
import { leerAjustesGerencia } from "@/lib/gerencia.functions";
import { ConfirmarBorrado } from "@/components/ConfirmarBorrado";
import { DescargarPdfs } from "@/components/archivo/DescargarPdfs";
import { deCompra, nombreZip } from "@/dominio/archivo";
import { SubidaFacturas } from "./SubidaFacturas";
import { ColaRevision } from "./ColaRevision";
import { ProformasPendientes } from "./ProformasPendientes";
import { CasarProforma, SelectorTipoDocumento, textoCasado } from "./CasarProforma";
import {
  cabecerasLineaPapel,
  clasesPartida,
  EtiquetaPartida,
  Campo,
  conTipoDocumento,
  FicheroRevision,
  FilaLineaPapel,
  pendientesDeProforma,
  RevisarCompraTextil,
  sugerenciasDeProforma,
  TarjetaQueMirar,
  type ExtraRegistro,
  type Revision,
} from "./RevisarCompraTextil";
import {
  avisosQueImportan,
  bloqueaRegistro,
  duplicadosDe,
  referenciaProformaDe,
  tipoDocumentoLeido,
} from "@/dominio/cola-compras";
import {
  esProforma,
  facturasPorProforma,
  FILTROS_DOCUMENTO,
  partidasLineaPapel,
  pasaFiltroDocumento,
  type FiltroDocumento,
  type ProformaFila,
} from "@/dominio/proformas";
import type { ResumenCasado } from "@/dominio/tipos-textil";
import {
  calcularCompra,
  cambiarLineaCompra,
  CATEGORIAS_COMPRA,
  categoriaCompra,
  descuadreLiquido,
  FORMAS_PAGO,
  lineaCompraNueva,
  TIPO_IVA_GENERAL,
  TIPOS_IRPF,
  TIPOS_IVA,
  tipoIrpfProbable,
  tipoProbable,
} from "@/dominio/compras";
import { sumarImportes } from "@/dominio/sumatorios";
import { totalesCompras } from "@/dominio/sumatorios-facturas";
import { invalidarTrasGuardar } from "@/lib/cache";

/**
 * Las facturas de compra. En modo «textil», las del género que entra en el
 * stock, como siempre. En modo «general», todas: cada una con su categoría,
 * que decide cómo cuenta en Gerencia (ver dominio/compras.ts), su retención
 * y, si es el recibo de un gasto fijo, el gasto al que corresponde.
 */
type Modo = "textil" | "general";

/** Está en la cola: la leyó la IA y nadie la ha confirmado, o no se pudo leer. */
const enCola = (c: any) => c.revision === "pendiente" || c.revision === "error";
const anioDe = (c: any): string => String(c.ejercicio ?? c.fecha?.slice(0, 4) ?? "");
const trimestreDe = (c: any): string =>
  String(c.trimestre ?? (c.fecha ? Math.floor((Number(c.fecha.slice(5, 7)) - 1) / 3) + 1 : ""));

const SIN_GASTO = "ninguno";
const SIN_FORMA = "sin_forma";
/** En el desplegable, de menos a más: sin retención primero. */
const TIPOS_IRPF_DE_MENOS_A_MAS = [...TIPOS_IRPF].sort((a, b) => a - b);
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
  // Lo que leyó la IA no viene en la lista: se pide al abrir la revisión.
  const verCompraFn = useServerFn(verCompra);
  const [abriendoRevision, setAbriendoRevision] = useState<string | null>(null);
  async function revisarDeLaCola(c: any) {
    setAbriendoRevision(c.id);
    try {
      const { lectura_ia } = await verCompraFn({ data: { id: c.id } });
      setRevisando(desdeFila({ ...c, lectura_ia }));
    } catch (e: any) {
      // Sin lo que leyó la IA, la revisión saldría con otro tipo de documento
      // o sin la referencia de la proforma: mejor no abrirla a medias.
      toast.error(e?.message ?? "No se pudo abrir la revisión. Vuelve a intentarlo.");
    } finally {
      setAbriendoRevision(null);
    }
  }
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
  // En Textil › Compras también: las que se suben ahí nacen como textil.
  const cola = data?.cola === true;
  // Con la migración del escáner textil: casado automático, reparto de portes
  // y registro en una sola transacción.
  const escaner = data?.escaner === true;
  // Con las migraciones de proformas: factura o proforma, casado y regularización.
  // Sin ellas, nada de proformas se ve (ni se manda).
  const proformas = data?.proformas === true;
  // Los duplicados se buscan entre TODAS las compras, no solo las de esta
  // pantalla: una factura textil puede estar ya registrada en Compras
  // generales con otra categoría (la IA la clasificó mal). En la pantalla
  // general ya están todas; en Textil › Compras se leen aparte (la misma
  // consulta que la pantalla general) al abrir una revisión.
  const todasFn = useServerFn(listCompras);
  const { data: todasData } = useQuery({
    queryKey: ["compras", "general"],
    queryFn: () => todasFn({ data: { soloTextil: false } }),
    enabled: !general && cola && !!revisando,
  });
  const paraDuplicados = !cola ? [] : general ? compras : (todasData?.compras ?? compras);
  const [viendoProveedores, setViendoProveedores] = useState(false);
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
    tipo_iva: compra.base > 0 ? tipoProbable(compra.base, compra.iva) : TIPO_IVA_GENERAL,
    tipo_irpf: (compra.base > 0 && tipoIrpfProbable(compra.base, compra.irpf)) || 0,
    origen: null,
    nota: "",
    concepto: "",
    forma_pago: null,
    tipo_documento: compra.tipo_documento ?? null,
    proforma_id: null,
    sinProforma: false,
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
      // Con la migración del escáner, cada línea trae su tipo, referencia,
      // color, talla, EAN y pack; sin ella, quedan como artículo suelto.
      lineas: (c.lineas ?? [])
        .slice()
        .sort((a: any, b: any) => (a.orden ?? 0) - (b.orden ?? 0))
        .map(lineaDesdeFila),
      referencia_proforma: referenciaProformaDe(c.lectura_ia),
    };
    // Lo que dijo la IA (nulo si dudó); si la lectura no lo trae, lo de la fila.
    const leido =
      c.lectura_ia && typeof c.lectura_ia === "object" && "tipo_documento" in c.lectura_ia;
    return {
      ...nueva(compra, null),
      id: c.id,
      categoria: c.categoria ?? "",
      gasto_id: c.gasto_id ?? null,
      // Si la cuota leída no la explica ningún tipo, que se elija a mano.
      tipo_iva: compra.base > 0 ? tipoProbable(compra.base, compra.iva) : TIPO_IVA_GENERAL,
      tipo_irpf: Number(c.tipo_irpf ?? 0),
      concepto: c.concepto ?? "",
      forma_pago: c.forma_pago ?? null,
      motivos: c.revision_motivo ?? null,
      fichero_huella: c.fichero_huella ?? null,
      otraFactura: false,
      tipo_documento: leido
        ? tipoDocumentoLeido(c.lectura_ia)
        : c.tipo_documento === "proforma" || c.tipo_documento === "factura"
          ? c.tipo_documento
          : null,
      proforma_id: c.proforma_id ?? null,
      sinProforma: false,
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
    fichero: "todos",
    documento: "todos",
  });
  // Por defecto, todo: la lista se abre como siempre.
  const periodo = usePeriodoUrl("todo");
  // Las proformas que ya tienen su factura (las facturas de la lista que apuntan a ellas).
  const facturaDe = useMemo(() => facturasPorProforma(compras as ProformaFila[]), [compras]);
  const casadas = useMemo(() => new Set(facturaDe.keys()), [facturaDe]);
  const porId = useMemo(
    () => new Map((compras as any[]).map((c) => [c.id as string, c])),
    [compras],
  );
  const filtroDocumento = (proformas ? filtros.documento : "todos") as FiltroDocumento;
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
        (filtros.fichero === "todos" || (filtros.fichero === "con") === !!c.fichero_ruta) &&
        pasaFiltroDocumento(c, filtroDocumento, casadas) &&
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
    filtros.fichero,
    filtroDocumento,
    casadas,
    periodo.rango,
  ]);
  // Los que se están viendo, para descargarlos en un ZIP.
  const docsFiltrados = useMemo(() => (filtrados as any[]).map(deCompra), [filtrados]);
  // El pie: lo que se ve, sin los borradores (no cuentan en Gerencia ni en el IVA).
  const totales = useMemo(() => totalesCompras(filtrados), [filtrados]);
  // Las proformas sin factura salen siempre, sin filtros ni periodo; las de la
  // cola, no (aún no están registradas).
  const paraProformas = useMemo(
    () => (proformas ? (compras as any[]).filter((c) => !(cola && enCola(c))) : []),
    [compras, cola, proformas],
  );
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
    meta: { invalida: false }, // no escribe nada: no recarga
    mutationFn: (fichero: File) => {
      const fd = new FormData();
      fd.append("fichero", fichero);
      return leerFn({ data: fd });
    },
    onSuccess: (r: any, fichero) => {
      setRevisando({ ...nueva(r.compra, r.bruto_json ?? null), fichero });
      if (r.avisos.length > 0) {
        toast.warning(`Leída con ${r.avisos.length} cosa(s) que revisar`);
      } else {
        toast.success("Factura leída. Revísala antes de registrarla.");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo leer la factura"),
  });

  const registrarFn = useServerFn(guardarYRegistrarCompra);
  const adjuntarFn = useServerFn(adjuntarFicheroCompra);
  const adjuntar = (id: string, fichero: File) => {
    const fd = new FormData();
    fd.append("id", id);
    fd.append("fichero", fichero);
    return adjuntarFn({ data: fd });
  };
  // Adjuntar desde la lista, a una compra que no tiene fichero.
  const adjuntarRef = useRef<HTMLInputElement>(null);
  const [adjuntandoA, setAdjuntandoA] = useState<string | null>(null);
  const adjuntarDesdeLista = useMutation({
    mutationFn: (v: { id: string; fichero: File }) => adjuntar(v.id, v.fichero),
    onSuccess: () => {
      toast.success("Fichero guardado");
      qc.invalidateQueries({ queryKey: ["compras"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo guardar el fichero"),
    onSettled: () => setAdjuntandoA(null),
  });
  const verFn = useServerFn(verFicheroCompra);
  /** La pestaña se abre con el clic: al volver de la red el navegador ya no deja. */
  async function verFichero(id: string) {
    const ventana = window.open("", "_blank");
    try {
      const { url } = await verFn({ data: { id } });
      if (ventana) ventana.location.href = url;
      else window.location.href = url;
    } catch (e: any) {
      ventana?.close();
      toast.error(e?.message ?? "No se pudo abrir el fichero");
    }
  }
  /**
   * Guarda y registra en una sola llamada (una transacción en la base). La
   * revisión textil manda sus líneas casadas y el proveedor que encontró; la
   * de siempre, las suyas con el casado a mano.
   */
  const registrar = useMutation({
    mutationFn: async (extra: ExtraRegistro | null) => {
      if (!revisando) throw new Error("Nada que registrar");
      if (!revisando.compra.fecha) throw new Error("Falta la fecha de la factura.");
      const { irpf, lineas: leidas, ...compra } = revisando.compra;
      const calculado = calcularCompra({
        base: compra.base,
        tipo_iva: revisando.tipo_iva ?? TIPO_IVA_GENERAL,
        tipo_irpf: revisando.tipo_irpf,
      });
      const descuadre = descuadreLiquido(calculado.liquido, compra.total) !== null;
      const textil = revisando.categoria === "textil";
      const r = await registrarFn({
        data: {
          ...compra,
          fecha: revisando.compra.fecha,
          // De la cola: se confirma la fila que leyó la IA.
          ...(revisando.id ? { id: revisando.id } : {}),
          ...(revisando.otraFactura
            ? { notas: "Confirmada como factura distinta (mismo proveedor, fecha e importe)." }
            : {}),
          categoria: revisando.categoria,
          // Las columnas de compras generales solo se mandan desde esa pantalla.
          ...(general ? { irpf, gasto_id: revisando.gasto_id } : {}),
          // Los tipos, con la migración de facturas recibidas: la base calcula
          // los importes con ellos.
          ...(recibidas
            ? {
                tipo_iva: revisando.tipo_iva ?? TIPO_IVA_GENERAL,
                tipo_irpf: revisando.tipo_irpf,
                ...(general || textil
                  ? {
                      liquido_origen:
                        descuadre && revisando.origen === "factura"
                          ? ("factura" as const)
                          : ("calculado" as const),
                      nota_descuadre:
                        descuadre && revisando.origen === "factura" ? revisando.nota : null,
                    }
                  : {}),
                ...(general
                  ? { concepto: revisando.concepto || null, forma_pago: revisando.forma_pago }
                  : {}),
              }
            : {}),
          lectura_ia: revisando.lectura,
          proveedor_id: extra?.proveedor_id ?? null,
          // Con las migraciones de proformas, qué documento es y con qué
          // proforma se casa. Sin ellas no se manda: la base vieja los ignoraría.
          ...(proformas
            ? {
                tipo_documento: revisando.tipo_documento ?? "factura",
                proforma_id: revisando.tipo_documento === "factura" ? revisando.proforma_id : null,
              }
            : {}),
          lineas:
            extra?.lineas ??
            leidas.map((l, i) =>
              lineaEnvioSimple(l, textil ? (revisando.asignaciones[i] ?? null) : null),
            ),
        },
      });
      // El fichero, después de registrar: si falla, la compra ya está bien
      // registrada y el fichero se adjunta desde la lista.
      let sinFichero: string | null = null;
      if (revisando.fichero) {
        try {
          await adjuntar(r.id, revisando.fichero);
        } catch (e: any) {
          sinFichero = e?.message ?? "error desconocido";
        }
      }
      return { ...r, sinFichero };
    },
    onSuccess: (r) => {
      toast.success(r.casado ? textoCasado(r.casado as ResumenCasado) : textoRegistrada(r));
      if (r.sinFichero) {
        toast.warning(`No se pudo guardar el fichero: ${r.sinFichero}. Adjúntalo desde la lista.`);
      }
      setRevisando(null);
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["textil-stock"] });
      qc.invalidateQueries({ queryKey: ["gerencia-compras"] });
      qc.invalidateQueries({ queryKey: ["escaner-memoria"] });
      qc.invalidateQueries({ queryKey: ["textil-productos"] });
      qc.invalidateQueries({ queryKey: ["proveedores"] });
      qc.invalidateQueries({ queryKey: ["proformas-pendientes"] });
      qc.invalidateQueries({ queryKey: ["almacen-movimientos"] });
      qc.invalidateQueries({ queryKey: ["almacen-controles"] });
      qc.invalidateQueries({ queryKey: ["gerencia-pagos-proveedores"] });
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
      qc.invalidateQueries({ queryKey: ["proformas-pendientes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo cambiar el pago"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-[260px] flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {general ? "Facturas de compra" : "Compras"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {general
              ? "Las facturas de tus proveedores: tinta, film, mensajería, máquinas, servicios… Cada una cuenta en Gerencia según lo que sea, y su IVA va al 303."
              : "Sube la factura del proveedor y da el género de alta en el stock."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DescargarPdfs
            docs={docsFiltrados}
            etiqueta="Descargar ficheros"
            nombreZip={nombreZip(
              periodo.seleccion,
              periodo.rango,
              general ? "Compras" : "Compras_textil",
            )}
          />
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
          {escaner && (
            <Button variant="outline" onClick={() => setViendoProveedores(true)}>
              <Users className="h-4 w-4 mr-2" /> Proveedores
            </Button>
          )}
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

      {!general && data && !escaner && (
        <Card className="border-amber-500/50">
          <CardContent className="flex gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p>{AVISO_MIGRACION_ESCANER}</p>
          </CardContent>
        </Card>
      )}

      {data && !proformas && (
        <Card className="border-amber-500/50">
          <CardContent className="flex gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p>{AVISO_MIGRACION_PROFORMAS}</p>
          </CardContent>
        </Card>
      )}

      {cola && (
        <SubidaFacturas
          deshabilitado={lector?.disponible === false}
          categoria={general ? undefined : "textil"}
          alTerminarUna={() => {
            qc.invalidateQueries({ queryKey: ["compras"] });
            void invalidarTrasGuardar(qc);
          }}
        />
      )}
      {cola && (
        <ColaRevision
          compras={enLaCola}
          onRevisar={(c) => {
            if (!abriendoRevision) void revisarDeLaCola(c);
          }}
          onBorrar={(c) => setBorrando(c)}
        />
      )}
      {proformas && <ProformasPendientes compras={paraProformas} onVerFichero={verFichero} />}

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
        <SelectFiltro
          etiqueta="Fichero"
          valor={filtros.fichero}
          alCambiar={(fichero) => cambiar({ fichero })}
          opciones={[
            { valor: "todos", etiqueta: "Con y sin fichero" },
            { valor: "con", etiqueta: "Con fichero" },
            { valor: "sin", etiqueta: "Sin fichero" },
          ]}
          ancho="w-[170px]"
        />
        {proformas && (
          <SelectFiltro
            etiqueta="Documento"
            valor={filtros.documento}
            alCambiar={(documento) => cambiar({ documento })}
            opciones={FILTROS_DOCUMENTO.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta }))}
            ancho="w-[200px] max-md:w-full"
          />
        )}
        <SelectorPeriodo periodo={periodo} />
        <QuitarFiltros visible={hay()} alQuitar={() => quitar()} />
      </BarraFiltros>
      <input
        ref={adjuntarRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && adjuntandoA) adjuntarDesdeLista.mutate({ id: adjuntandoA, fichero: f });
          else setAdjuntandoA(null);
        }}
      />
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
                  <TableCell className="whitespace-nowrap">{c.fecha ?? "—"}</TableCell>
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
                  <TableCell className="font-mono text-xs">
                    <span className="whitespace-nowrap">{c.numero ?? "—"}</span>
                    {/* Debajo del número: al lado ensanchaba la columna y partía las demás. */}
                    {esProforma(c) && (
                      <Badge
                        variant="outline"
                        className="mt-0.5 flex w-fit border-amber-500 font-sans text-amber-700"
                      >
                        Proforma
                      </Badge>
                    )}
                    {esProforma(c) && facturaDe.get(c.id) && (
                      <span className="block font-sans text-xs text-muted-foreground">
                        Facturada en n.º{" "}
                        <span className="whitespace-nowrap">
                          {facturaDe.get(c.id)?.numero ?? "(sin número)"}
                        </span>
                      </span>
                    )}
                    {!esProforma(c) && c.proforma_id && (
                      <span className="block font-sans text-xs text-muted-foreground">
                        De la proforma n.º{" "}
                        <span className="whitespace-nowrap">
                          {porId.get(c.proforma_id)?.numero ?? "(sin número)"}
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{eur(Number(c.base))}</TableCell>
                  <TableCell className="text-right font-medium">
                    {eur(Number(c.liquido ?? c.total))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={estadoDe(c) === "registrada" ? "default" : "outline"}>
                      {estadoDe(c)}
                    </Badge>
                    {esProforma(c) && casadas.has(c.id)
                      ? // El pago de la proforma casada vive en su factura.
                        facturaDe.get(c.id)?.estado_pago === "pagada" && (
                          <span className="block text-xs text-muted-foreground">
                            Pagada con su factura n.º{" "}
                            <span className="whitespace-nowrap">
                              {facturaDe.get(c.id)?.numero ?? "(sin número)"}
                            </span>
                          </span>
                        )
                      : // En Textil, solo las proformas y las facturas casadas (que
                        // heredan su pago): así la proforma y su factura dicen lo mismo.
                        (general || esProforma(c) || !!c.proforma_id) &&
                        c.estado_pago === "pagada" &&
                        !c.borrada_en && (
                          <span className="block text-xs text-muted-foreground">
                            Pagada el {fechaCorta(c.fecha_pago)}
                          </span>
                        )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      {c.fichero_ruta ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Ver el fichero"
                          aria-label="Ver el fichero"
                          onClick={() => verFichero(c.id)}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      ) : (
                        !c.borrada_en && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Sin fichero: adjuntarlo"
                            aria-label="Adjuntar el fichero"
                            disabled={adjuntarDesdeLista.isPending}
                            onClick={() => {
                              setAdjuntandoA(c.id);
                              adjuntarRef.current?.click();
                            }}
                          >
                            {adjuntandoA === c.id && adjuntarDesdeLista.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Paperclip className="h-4 w-4 text-status-pendiente" />
                            )}
                          </Button>
                        )
                      )}
                      {(general || (proformas && esProforma(c))) &&
                        recibidas &&
                        c.estado === "registrada" &&
                        !c.borrada_en &&
                        // La proforma casada no: su pago pasó a la factura.
                        !(esProforma(c) && casadas.has(c.id)) &&
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
                          (c.categoria ?? "textil") !== "textil" &&
                          // Un casado no se deshace: ni la factura ni su proforma se borran.
                          !c.proforma_id &&
                          !casadas.has(c.id))) && (
                        <Button variant="ghost" size="icon" onClick={() => setBorrando(c)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {!isLoading && filtrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={general ? 4 : 3} className="font-semibold">
                    Total · {totales.facturas} factura{totales.facturas === 1 ? "" : "s"}
                    {totales.borradores > 0 &&
                      ` · sin ${totales.borradores} borrador${totales.borradores === 1 ? "" : "es"}`}
                    {totales.proformas > 0 &&
                      ` · sin ${totales.proformas} proforma${totales.proformas === 1 ? "" : "s"}`}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(totales.base)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {eur(totales.liquido)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
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

      {viendoProveedores && <ProveedoresDialog onCerrar={() => setViendoProveedores(false)} />}

      <Dialog open={!!revisando} onOpenChange={(o) => !o && setRevisando(null)}>
        {revisando && escaner && revisando.categoria === "textil" && (
          // Con el escáner, toda factura textil se revisa con el casado y el
          // reparto: ninguna se registra casada a mano y sin ver los costes.
          <RevisarCompraTextil
            conTipos={recibidas}
            conProformas={proformas}
            todas={paraDuplicados}
            onDescartar={() => {
              const fila = compras.find((c: any) => c.id === revisando.id);
              setRevisando(null);
              if (fila) setBorrando(fila);
            }}
            estado={revisando}
            stock={stock}
            onCambiar={setRevisando}
            onRegistrar={(extra) => registrar.mutate(extra)}
            registrando={registrar.isPending}
            onCambiarCategoria={
              general ? () => setRevisando({ ...revisando, categoria: "" }) : undefined
            }
          />
        )}
        {revisando && !(escaner && revisando.categoria === "textil") && (
          <RevisarCompra
            modo={modo}
            conTipos={recibidas}
            conProformas={proformas}
            todas={paraDuplicados}
            onDescartar={() => {
              const fila = compras.find((c: any) => c.id === revisando.id);
              setRevisando(null);
              if (fila) setBorrando(fila);
            }}
            estado={revisando}
            gastos={gastos}
            stock={stock}
            onCambiar={setRevisando}
            onRegistrar={() => registrar.mutate(null)}
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
  conProformas,
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
  /** Con las migraciones de proformas: factura o proforma, y casado. */
  conProformas: boolean;
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
            ...(conProformas
              ? {
                  tipo_documento: estado.tipo_documento ?? "factura",
                  proforma_id: estado.proforma_id,
                }
              : {}),
          },
          todas,
        )
      : [];
  const duplicadoQueBloquea = duplicados.find(bloqueaRegistro);
  const porConfirmar = duplicados.filter((d) => !bloqueaRegistro(d) && !d.borrada);
  // Proforma: qué documento es y, si es una factura, de qué proforma.
  const esProformaRev = conProformas && estado.tipo_documento === "proforma";
  const sugerencias = sugerenciasDeProforma(
    conProformas,
    estado,
    {
      id: estado.id ?? null,
      proveedor: compra.proveedor,
      nif_proveedor: compra.nif_proveedor,
      proveedor_id: null,
      fecha: compra.fecha,
      base: compra.base,
      total: compra.total,
      liquido: conCalculo ? calculado.liquido : null,
      categoria: estado.categoria || null,
      referencia_proforma: compra.referencia_proforma ?? null,
      unidades: null,
    },
    todas as ProformaFila[],
  );
  const faltaDeProforma = pendientesDeProforma(conProformas, estado, sugerencias);
  const casadaCon = conProformas && estado.tipo_documento === "factura" && !!estado.proforma_id;
  const cabeceras = cabecerasLineaPapel(compra.lineas);
  const partidas = partidasLineaPapel(compra.lineas);
  // Se guarda y se registra a la vez: sin fecha no se sabe en qué periodo cuenta.
  const sinFecha = !compra.fecha;
  const sinDescripcion = compra.lineas.some((l) => !l.descripcion.trim());
  const bloqueada =
    sinFecha ||
    sinDescripcion ||
    !!duplicadoQueBloquea ||
    (porConfirmar.length > 0 && !estado.otraFactura) ||
    faltaDeProforma.length > 0 ||
    (esTextil
      ? compra.lineas.length === 0 || sinCasar > 0
      : sinCategoria || (conCalculo && (estado.tipo_iva === null || descuadreSinResolver)));

  const set = (cambios: Partial<CompraLeida>) =>
    onCambiar({ ...estado, compra: { ...compra, ...cambios } });

  // Al cambiar la cantidad o el coste, el importe de la línea se recalcula;
  // al cambiar el importe (uno con descuento), el coste unitario.
  const setLinea = (i: number, cambios: Partial<CompraLeida["lineas"][number]>) =>
    set({ lineas: compra.lineas.map((l, j) => (i === j ? cambiarLineaCompra(l, cambios) : l)) });

  const setAsignacion = (i: number, valor: string | null) =>
    onCambiar({
      ...estado,
      asignaciones: asignaciones.map((a, j) => (i === j ? valor : a)),
    });

  return (
    <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {esProformaRev
            ? esTextil
              ? "Revisar la proforma antes de dar de alta el género"
              : "Revisar la proforma"
            : general
              ? "Revisar la factura antes de registrarla"
              : "Revisar la compra antes de darla de alta"}
        </DialogTitle>
        <DialogDescription>
          {esProformaRev
            ? "No cuenta en el IVA ni en Gerencia; su factura se casa con ella cuando llegue."
            : esTextil
              ? "Lo que se registre entra en el libro de stock y no se puede borrar. Comprueba las cantidades y di a qué artículo del catálogo corresponde cada línea."
              : "Comprueba los importes y di qué es: de eso depende cómo cuenta en Gerencia. Una factura registrada no se borra."}
        </DialogDescription>
      </DialogHeader>

      <TarjetaQueMirar
        motivos={estado.motivos ?? null}
        duplicados={duplicados}
        conId={!!estado.id}
        otraFactura={!!estado.otraFactura}
        onDescartar={onDescartar}
        onOtraFactura={() => onCambiar({ ...estado, otraFactura: !estado.otraFactura })}
      />

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

      {conProformas && (
        <SelectorTipoDocumento
          valor={estado.tipo_documento}
          onCambiar={(t) => onCambiar(conTipoDocumento(estado, t))}
        />
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
            <Fragment key={i}>
              {cabeceras.get(i) && (
                <FilaLineaPapel
                  grupo={cabeceras.get(i)!}
                  lineas={compra.lineas}
                  columnas={esTextil ? 5 : 4}
                />
              )}
              <TableRow className={clasesPartida(partidas.get(i)).fila}>
                <TableCell className={clasesPartida(partidas.get(i)).celda}>
                  <EtiquetaPartida partida={partidas.get(i)} talla={l.talla} />
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
                <TableCell>
                  <Input
                    type="number"
                    step="any"
                    className="text-right"
                    value={l.importe}
                    onChange={(e) => setLinea(i, { importe: Number(e.target.value) })}
                  />
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
            </Fragment>
          ))}
        </TableBody>
        {compra.lineas.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Total · {compra.lineas.length} línea{compra.lineas.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {eur(sumarImportes(compra.lineas, (l) => l.importe))}
              </TableCell>
              {esTextil && <TableCell />}
            </TableRow>
          </TableFooter>
        )}
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
              lineas: [...compra.lineas, lineaCompraNueva()],
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
                  {TIPOS_IRPF_DE_MENOS_A_MAS.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {porcentaje(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Campo
              etiqueta={`IVA según ${esProformaRev ? "la proforma" : "la factura"}`}
              tipo="number"
              valor={String(compra.iva)}
              onChange={(v) => set({ iva: Number(v) })}
            />
            <Campo
              etiqueta={`IRPF según ${esProformaRev ? "la proforma" : "la factura"}`}
              tipo="number"
              valor={String(compra.irpf)}
              onChange={(v) => set({ irpf: Number(v) })}
            />
            <Campo
              etiqueta={`A pagar según ${esProformaRev ? "la proforma" : "la factura"}`}
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

      {conProformas && estado.tipo_documento === "factura" && (
        <CasarProforma
          sugerencias={sugerencias}
          proformaId={estado.proforma_id}
          sinProforma={!!estado.sinProforma}
          onElegir={(proforma_id) => onCambiar({ ...estado, proforma_id, sinProforma: false })}
          onNinguna={() =>
            onCambiar({ ...estado, proforma_id: null, sinProforma: !estado.sinProforma })
          }
          liquidoFactura={conCalculo ? calculado.liquido : compra.total}
          textil={null}
        />
      )}

      {!estado.id && (
        <FicheroRevision
          fichero={estado.fichero ?? null}
          onCambiar={(fichero) => onCambiar({ ...estado, fichero })}
        />
      )}

      <DialogFooter className="items-center gap-3">
        {faltaDeProforma.length > 0 && (
          <span className="text-sm text-muted-foreground mr-auto">{faltaDeProforma[0]}</span>
        )}
        {sinFecha && (
          <span className="text-sm text-muted-foreground mr-auto">
            Falta la fecha de la factura.
          </span>
        )}
        {sinDescripcion && (
          <span className="text-sm text-muted-foreground mr-auto">Hay líneas sin descripción.</span>
        )}
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
          <span className="text-sm text-destructive mr-auto">
            {duplicadoQueBloquea.facturaDeProforma
              ? "Su factura ya está registrada."
              : "Ya está registrada."}
          </span>
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
          ) : casadaCon ? (
            <FileText className="h-4 w-4 mr-2" />
          ) : (
            <PackageCheck className="h-4 w-4 mr-2" />
          )}
          {casadaCon
            ? "Registrar factura casada con la proforma"
            : esProformaRev && !esTextil
              ? "Registrar proforma"
              : esTextil
                ? "Dar de alta en el stock"
                : "Registrar factura"}
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

/** «Registrada: 12 líneas al stock, 3 variantes nuevas, 9 referencias aprendidas». */
function textoRegistrada(r: {
  movidas: number;
  variantes_creadas: number;
  aprendidas: number;
  tipo_documento?: string | null;
}) {
  const proforma = r.tipo_documento === "proforma";
  if (r.movidas <= 0) return proforma ? "Proforma registrada" : "Factura registrada";
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const partes = [plural(r.movidas, "línea al stock", "líneas al stock")];
  if (r.variantes_creadas > 0)
    partes.push(plural(r.variantes_creadas, "variante nueva", "variantes nuevas"));
  if (r.aprendidas > 0)
    partes.push(plural(r.aprendidas, "referencia aprendida", "referencias aprendidas"));
  return `${proforma ? "Proforma registrada" : "Registrada"}: ${partes.join(", ")}`;
}

/**
 * Los proveedores de las compras: corregir un NIF o un nombre mal leídos, o
 * dejar de usar uno. Las compras ya registradas conservan el texto de su
 * factura; esto no las toca.
 */
function ProveedoresDialog({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listProveedores);
  const { data, isLoading } = useQuery({ queryKey: ["proveedores"], queryFn: () => listFn() });
  const guardarFn = useServerFn(guardarProveedor);
  const [editando, setEditando] = useState<{
    id: string;
    nombre: string;
    nif: string;
    activo: boolean;
  } | null>(null);
  const guardar = useMutation({
    mutationFn: (p: { id: string; nombre: string; nif: string | null; activo: boolean }) =>
      guardarFn({ data: p }),
    onSuccess: () => {
      toast.success("Proveedor guardado");
      setEditando(null);
      qc.invalidateQueries({ queryKey: ["proveedores"] });
      qc.invalidateQueries({ queryKey: ["escaner-memoria"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "No se pudo guardar el proveedor"),
  });
  const proveedores = data?.proveedores ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proveedores</DialogTitle>
          <DialogDescription>
            Se dan de alta solos al registrar una factura textil. Aquí se corrige un NIF o un nombre
            mal leídos; las facturas ya registradas conservan el texto que traían.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : data?.disponible === false ? (
          <p className="text-sm text-muted-foreground">{AVISO_MIGRACION_ESCANER}</p>
        ) : proveedores.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no hay proveedores: nacen al registrar la primera factura textil.
          </p>
        ) : (
          <Table movil="tarjetas">
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>NIF</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead aria-label="Acciones" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {proveedores.map((p) =>
                editando?.id === p.id ? (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Input
                        value={editando.nombre}
                        onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editando.nif}
                        onChange={(e) => setEditando({ ...editando, nif: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={editando.activo}
                        onCheckedChange={(activo) => setEditando({ ...editando, activo })}
                        aria-label="Activo"
                      />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        disabled={!editando.nombre.trim() || guardar.isPending}
                        onClick={() =>
                          guardar.mutate({
                            id: editando.id,
                            nombre: editando.nombre.trim(),
                            nif: editando.nif.trim() || null,
                            activo: editando.activo,
                          })
                        }
                      >
                        Guardar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                        Cancelar
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nombre}</TableCell>
                    <TableCell className="font-mono text-xs">{p.nif ?? "—"}</TableCell>
                    <TableCell>{p.activo ? "Sí" : <Badge variant="outline">No</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditando({
                            id: p.id,
                            nombre: p.nombre,
                            nif: p.nif ?? "",
                            activo: p.activo,
                          })
                        }
                      >
                        Editar
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
