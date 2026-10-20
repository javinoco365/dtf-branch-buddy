import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  FileText,
  Loader2,
  PackageCheck,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { eur, eurConSigno, eurUnitario, numeroJusto } from "@/lib/format";
import {
  lineaEnvioSimple,
  mensajeErrorEscaner,
  packDe,
  textoONulo as texto,
  tipoDe,
  type LineaEnvio,
} from "@/lib/escaner-textil";
import { leerMemoriaEscaner, listProductosTextil } from "@/lib/escaner-textil.functions";
import { SelectorStockTextil } from "@/components/textil/SelectorStockTextil";
import { CrearVarianteDialog, type LineaParaCrear } from "@/components/textil/CrearVarianteDialog";
import { revisarCompra, type CompraLeida, type LineaLeida } from "@/dominio/factura-compra";
import {
  avisoDuplicado,
  avisosQueImportan,
  bloqueaRegistro,
  duplicadosDe,
  type Duplicado,
} from "@/dominio/cola-compras";
import {
  calcularCompra,
  cambiarLineaCompra,
  descuadreLiquido,
  lineaCompraNueva,
  TIPOS_IVA,
} from "@/dominio/compras";
import { sumarImportes } from "@/dominio/sumatorios";
import { casarLineas, nuevaVarianteDesdeLinea } from "@/dominio/casado-textil";
import { claveNif, claveTexto } from "@/dominio/normalizar-textil";
import { repartirCostes, unidadesDeLinea } from "@/dominio/reparto-compra";
import { aVarianteCatalogo, etiquetaVariante } from "@/dominio/stock-textil";
import {
  facturasPorProforma,
  gruposPorLineaPapel,
  partidasLineaPapel,
  sugerirProformas,
  type ArticuloFactura,
  grupoDeNueva,
  varianteDeNueva,
  type DocumentoParaCasar,
  type ProformaFila,
  type StockActual,
} from "@/dominio/proformas";
import {
  ETIQUETAS_TIPO_LINEA,
  TIPOS_LINEA_COMPRA,
  type Casado,
  type LineaParaCasar,
  type MetodoCasado,
  type NuevaVariante,
  type TipoDocumentoCompra,
  type TipoLineaCompra,
  type VarianteCatalogo,
} from "@/dominio/tipos-textil";
import { CasarProforma, SelectorTipoDocumento } from "./CasarProforma";

/**
 * Lo que la persona ha decidido sobre el casado de una línea textil.
 * «auto»: lo que diga el casado automático (memoria, EAN o referencia).
 */
export type Eleccion =
  | { tipo: "auto" }
  | { tipo: "sugerencia" | "manual"; stock_id: string }
  | { tipo: "nueva"; nueva: NuevaVariante };

/** La revisión de una factura de compra, la misma para las dos pantallas. */
export type Revision = {
  compra: CompraLeida;
  /** Casado a mano con el desplegable (sin la migración del escáner). */
  asignaciones: (string | null)[];
  /** Casado con el escáner (con la migración): una por línea; si falta, «auto». */
  elecciones?: Eleccion[];
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
  /**
   * El fichero de la factura, para guardarlo al registrar: el que se leyó o el
   * que se adjunta a mano. Las de la cola ya tienen el suyo guardado.
   */
  fichero?: File | null;
  /** Confirmado que no es un duplicado (mismo proveedor, fecha e importe). */
  otraFactura?: boolean;
  /**
   * Factura o proforma (con las migraciones de proformas). Nulo si la IA dudó:
   * se elige antes de registrar.
   */
  tipo_documento: TipoDocumentoCompra | null;
  /** La proforma con la que se casa esta factura; la elige la persona. */
  proforma_id: string | null;
  /** Dicho que no es de ninguna de las proformas sugeridas. */
  sinProforma?: boolean;
};

/** Cómo queda la revisión al cambiar de factura a proforma o al revés. */
export const conTipoDocumento = (r: Revision, tipo: TipoDocumentoCompra): Revision => ({
  ...r,
  tipo_documento: tipo,
  // Una proforma no se casa con otra: el casado es de la factura.
  proforma_id: tipo === "proforma" ? null : r.proforma_id,
  sinProforma: tipo === "proforma" ? false : r.sinProforma,
});

/**
 * Las proformas que pueden ser de esta factura, entre todas las compras. Vacío
 * si es una proforma, si aún no se sabe qué es o sin las migraciones.
 */
export function sugerenciasDeProforma(
  conProformas: boolean,
  estado: Revision,
  documento: DocumentoParaCasar,
  todas: readonly ProformaFila[],
) {
  if (!conProformas || estado.tipo_documento !== "factura") return [];
  const casadas = new Set(facturasPorProforma(todas).keys());
  return sugerirProformas(documento, todas, casadas);
}

/**
 * Lo que falta decidir del documento y de su proforma antes de registrar (con
 * las migraciones de proformas).
 */
export function pendientesDeProforma(
  conProformas: boolean,
  estado: Revision,
  sugerencias: readonly { proforma: { id: string } }[],
): string[] {
  if (!conProformas) return [];
  if (estado.tipo_documento === null) return ["Elige si es factura o proforma."];
  if (estado.tipo_documento !== "factura") return [];
  if (estado.proforma_id) {
    return sugerencias.some((x) => x.proforma.id === estado.proforma_id)
      ? []
      : ["La proforma elegida ya no encaja con este documento: elige otra."];
  }
  // Registrar sin casar, con su proforma ya en el stock, duplica el género, y
  // el casado solo se puede hacer al registrar.
  return sugerencias.length > 0 && !estado.sinProforma
    ? ["Di si esta factura es de una de las proformas sugeridas."]
    : [];
}

/**
 * Las filas de cabecera de las líneas partidas por tallas: en el índice de la
 * primera partida de cada línea del papel con más de una, su número y sus
 * partidas.
 */
export function cabecerasLineaPapel(
  lineas: readonly { linea_papel?: number | null }[],
): Map<number, { linea_papel: number; indices: number[] }> {
  const mapa = new Map<number, { linea_papel: number; indices: number[] }>();
  for (const g of gruposPorLineaPapel(lineas)) {
    if (g.linea_papel !== null && g.indices.length > 1) {
      mapa.set(g.indices[0], { linea_papel: g.linea_papel, indices: g.indices });
    }
  }
  return mapa;
}

/** Las clases de la fila y de su primera celda si es una partida. */
export function clasesPartida(p: { ultima: boolean } | undefined) {
  if (!p) return { fila: "", celda: "" };
  return {
    fila: p.ultima ? "border-b-2 border-b-muted-foreground/30" : "",
    celda: "border-l-4 border-l-muted-foreground/30",
  };
}

/** En el móvil (tarjetas), de qué línea del papel sale esta partida. */
export function EtiquetaPartida({
  partida,
  talla,
}: {
  partida: { linea_papel: number } | undefined;
  talla: string | null | undefined;
}) {
  if (!partida) return null;
  return (
    <span className="mb-1 block text-xs text-muted-foreground md:hidden">
      Línea {partida.linea_papel} del papel{talla ? ` · talla ${talla}` : ""}
    </span>
  );
}

/** «Línea 2 del papel · 3 tallas · 45,00 €», encima de sus partidas. */
export function FilaLineaPapel({
  grupo,
  lineas,
  columnas,
}: {
  grupo: { linea_papel: number; indices: number[] };
  lineas: readonly { importe: number }[];
  columnas: number;
}) {
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={columnas} className="py-1 text-xs font-normal text-muted-foreground">
        Línea {grupo.linea_papel} del papel · {grupo.indices.length} tallas ·{" "}
        {eur(
          sumarImportes(
            grupo.indices.map((i) => lineas[i]),
            (l) => l.importe,
          ),
        )}
      </TableCell>
    </TableRow>
  );
}

/** Lo que añade la revisión textil al registrar. */
export type ExtraRegistro = { proveedor_id: string | null; lineas: LineaEnvio[] };

const paraCasar = (l: LineaLeida): LineaParaCasar => ({
  tipo: tipoDe(l),
  descripcion: l.descripcion,
  referencia: texto(l.referencia),
  marca: texto(l.marca),
  modelo: texto(l.modelo),
  color: texto(l.color),
  talla: texto(l.talla),
  ean: texto(l.ean),
});

/** El texto con el que se abre el buscador de «Elegir…». */
const textoBusqueda = (l: LineaLeida) =>
  [l.marca, l.referencia].filter((t) => texto(t)).join(" ") || texto(l.modelo) || l.descripcion;

/** Espera a que se deje de escribir para no preguntar a la base en cada tecla. */
function useConPausa(valor: string, ms = 400): string {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Cambiar lo que identifica la prenda vuelve a casar la línea. */
const CAMPOS_CASADO = ["tipo", "referencia", "color", "talla", "ean"] as const;

/** Cómo queda una línea: lo que se registra y cómo se enseña. */
type Efectiva =
  | { estado: "no_aplica" }
  | { estado: "nueva"; nueva: NuevaVariante }
  | {
      estado: "casada";
      stock_id: string;
      metodo: MetodoCasado;
      /** El pack que aprendió la memoria (solo si el casado es de memoria). */
      packMemoria: number | null;
    }
  | { estado: "sugerida"; casado: Extract<Casado, { estado: "sugerida" }> }
  | { estado: "sin_casar" };

function efectivaDe(tipo: TipoLineaCompra, casado: Casado, eleccion: Eleccion): Efectiva {
  if (tipo !== "articulo") return { estado: "no_aplica" };
  if (eleccion.tipo === "nueva") return { estado: "nueva", nueva: eleccion.nueva };
  if (eleccion.tipo === "manual" || eleccion.tipo === "sugerencia") {
    return {
      estado: "casada",
      stock_id: eleccion.stock_id,
      metodo: eleccion.tipo,
      packMemoria: null,
    };
  }
  if (casado.estado === "casada") {
    return {
      estado: "casada",
      stock_id: casado.stock_id,
      metodo: casado.metodo,
      packMemoria: casado.unidades_por_pack,
    };
  }
  if (casado.estado === "sugerida") return { estado: "sugerida", casado };
  return { estado: "sin_casar" };
}

const ETIQUETA_METODO: Record<MetodoCasado, string> = {
  memoria: "Memoria",
  ean: "EAN",
  referencia: "Referencia",
  sugerencia: "Sugerencia aceptada",
  manual: "Elegida a mano",
  nueva: "Nueva",
};

/**
 * La revisión de una factura textil con el escáner: casado automático con la
 * memoria del proveedor, el EAN y la referencia; sugerencias que solo se
 * asignan al pulsarlas; variantes nuevas prerrellenadas desde la línea; y el
 * reparto de portes y descuentos entre los artículos, para que el coste de
 * entrada sume la base de la factura al céntimo.
 *
 * Lo que se registra entra en el libro de stock y no se borra: por eso nada
 * se registra con una línea sin variante ni con un reparto que no cuadra.
 */
export function RevisarCompraTextil({
  conTipos,
  conProformas,
  todas,
  onDescartar,
  estado,
  stock,
  onCambiar,
  onRegistrar,
  registrando,
  onCambiarCategoria,
}: {
  /** Con la migración de facturas recibidas: tipos, cálculo y descuadre. */
  conTipos: boolean;
  /** Con las migraciones de proformas: factura o proforma, y casado. */
  conProformas: boolean;
  /** Todas las compras, para avisar de duplicados (vacío sin la cola). */
  todas: any[];
  onDescartar: () => void;
  estado: Revision;
  /** Las filas de listStock. */
  stock: any[];
  onCambiar: (e: Revision) => void;
  onRegistrar: (extra: ExtraRegistro) => void;
  registrando: boolean;
  /** Si se puede cambiar a otra categoría (pantalla general). */
  onCambiarCategoria?: () => void;
}) {
  const { compra } = estado;
  const lineas = compra.lineas;
  const variantes = useMemo(
    () => (stock as Record<string, unknown>[]).map(aVarianteCatalogo),
    [stock],
  );
  const porId = useMemo(() => new Map(variantes.map((v) => [v.id, v])), [variantes]);

  const productosFn = useServerFn(listProductosTextil);
  const { data: datosProductos } = useQuery({
    queryKey: ["textil-productos"],
    queryFn: () => productosFn(),
  });
  const productos = useMemo(() => datosProductos?.productos ?? [], [datosProductos]);

  // La memoria del proveedor: por NIF o por nombre, tal como estén escritos.
  // Se compara como texto: un objeto nuevo en cada render no dejaría de esperar.
  const quienTexto = useConPausa(JSON.stringify([compra.nif_proveedor, compra.proveedor]));
  const quien = useMemo(() => {
    const [nif, proveedor] = JSON.parse(quienTexto) as [string | null, string | null];
    return { nif, proveedor };
  }, [quienTexto]);
  const claveQuien = `${claveNif(quien.nif)}|${claveTexto(quien.proveedor)}`;
  const claveAhora = `${claveNif(compra.nif_proveedor)}|${claveTexto(compra.proveedor)}`;
  const memoriaFn = useServerFn(leerMemoriaEscaner);
  const { data: memoria, isFetching: leyendoMemoria } = useQuery({
    queryKey: ["escaner-memoria", claveQuien],
    queryFn: () =>
      memoriaFn({
        data: { proveedor_id: null, nif: quien.nif ?? null, proveedor: quien.proveedor ?? null },
      }),
    enabled: claveQuien !== "|",
  });
  // El proveedor encontrado solo vale si es el de lo que está escrito ahora:
  // con un NIF corregido, el viejo daría «el NIF no es el del proveedor».
  const memoriaAlDia = claveQuien === claveAhora && !leyendoMemoria;
  const proveedorConocido = memoriaAlDia ? (memoria?.proveedor ?? null) : null;
  const entradasMemoria = useMemo(() => memoria?.entradas ?? [], [memoria]);

  const casados = useMemo(
    () =>
      casarLineas(lineas.map(paraCasar), {
        variantes,
        memoria: claveQuien !== "|" ? entradasMemoria : [],
      }),
    [lineas, variantes, entradasMemoria, claveQuien],
  );
  const eleccionDe = (i: number): Eleccion =>
    estado.elecciones?.[i] ??
    (estado.asignaciones[i]
      ? { tipo: "manual", stock_id: estado.asignaciones[i] as string }
      : { tipo: "auto" });
  const efectivas = lineas.map((l, i) => efectivaDe(tipoDe(l), casados[i], eleccionDe(i)));

  const reparto = useMemo(
    () =>
      repartirCostes(
        lineas.map((l) => ({
          tipo: tipoDe(l),
          cantidad: l.cantidad,
          unidades_por_pack: packDe(l),
          importe: l.importe,
        })),
        compra.base,
      ),
    [lineas, compra.base],
  );
  const costePorLinea = new Map(reparto.ok ? reparto.entradas.map((e) => [e.indice, e]) : []);

  // --- Cambios ---------------------------------------------------------------
  const set = (cambios: Partial<CompraLeida>) =>
    onCambiar({ ...estado, compra: { ...compra, ...cambios } });
  const todasLasElecciones = () => lineas.map((_, i) => eleccionDe(i));
  const ponerEleccion = (i: number, e: Eleccion) => {
    const elecciones = todasLasElecciones().map((x, j) => (j === i ? e : x));
    onCambiar({
      ...estado,
      elecciones,
      // El desplegable de siempre ve lo mismo si se cambia la categoría.
      asignaciones: elecciones.map((x) =>
        x.tipo === "manual" || x.tipo === "sugerencia" ? x.stock_id : null,
      ),
    });
  };
  const setLinea = (i: number, cambios: Partial<LineaLeida>) => {
    const nuevas = lineas.map((l, j) => (i === j ? cambiarLineaCompra(l, cambios) : l));
    const recasar = CAMPOS_CASADO.some((k) => k in cambios);
    const elecciones = todasLasElecciones().map((x, j) =>
      j === i && recasar ? ({ tipo: "auto" } as Eleccion) : x,
    );
    onCambiar({
      ...estado,
      compra: { ...compra, lineas: nuevas },
      elecciones,
      asignaciones: estado.asignaciones.map((a, j) => (j === i && recasar ? null : a)),
    });
  };
  const anadirLinea = () =>
    onCambiar({
      ...estado,
      compra: { ...compra, lineas: [...lineas, lineaCompraNueva()] },
      elecciones: [...todasLasElecciones(), { tipo: "auto" }],
      asignaciones: [...estado.asignaciones, null],
    });
  const quitarLinea = (i: number) =>
    onCambiar({
      ...estado,
      compra: { ...compra, lineas: lineas.filter((_, j) => j !== i) },
      elecciones: todasLasElecciones().filter((_, j) => j !== i),
      asignaciones: estado.asignaciones.filter((_, j) => j !== i),
    });

  // --- Diálogos --------------------------------------------------------------
  const [eligiendo, setEligiendo] = useState<number | null>(null);
  const [creando, setCreando] = useState<number[] | null>(null);
  const lineasParaCrear = (indices: number[]): LineaParaCrear[] =>
    indices.map((i) => {
      const l = lineas[i];
      const e = eleccionDe(i);
      return {
        indice: i,
        descripcion: l.descripcion,
        marca: texto(l.marca),
        referencia: texto(l.referencia),
        propuesta: e.tipo === "nueva" ? e.nueva : nuevaVarianteDesdeLinea(paraCasar(l), productos),
        coste_entrada: costePorLinea.get(i)?.coste_unitario ?? null,
      };
    });
  const faltan = efectivas
    .map((e, i) => (e.estado === "sin_casar" || e.estado === "sugerida" ? i : -1))
    .filter((i) => i >= 0);

  // --- Comprobaciones --------------------------------------------------------
  const avisos = avisosQueImportan(revisarCompra(compra), "textil");
  const calculado = calcularCompra({
    base: compra.base,
    tipo_iva: estado.tipo_iva ?? 0,
    tipo_irpf: estado.tipo_irpf,
  });
  const descuadre = conTipos ? descuadreLiquido(calculado.liquido, compra.total) : null;
  const descuadreSinResolver =
    descuadre !== null &&
    (estado.origen === null || (estado.origen === "factura" && !estado.nota.trim()));
  const duplicados =
    todas.length > 0
      ? duplicadosDe(
          {
            id: estado.id,
            proveedor: compra.proveedor,
            nif_proveedor: compra.nif_proveedor,
            numero: compra.numero,
            fecha: compra.fecha,
            liquido: conTipos ? calculado.liquido : compra.total,
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
  const sinDescripcion = lineas.some((l) => !l.descripcion.trim());
  const sinProveedor = !texto(compra.proveedor) && !texto(compra.nif_proveedor);

  // --- Proforma ---------------------------------------------------------------
  const esProformaRev = conProformas && estado.tipo_documento === "proforma";
  const articulosFactura: ArticuloFactura[] = [];
  lineas.forEach((l, i) => {
    if (tipoDe(l) !== "articulo") return;
    const e = efectivas[i];
    // Una «variante nueva» que ya está en el catálogo: la base la reutiliza
    // (paso 4.6), así que la previsión también.
    const nueva = e.estado === "nueva" ? e.nueva : null;
    articulosFactura.push({
      indice: i,
      stock_id:
        e.estado === "casada"
          ? e.stock_id
          : nueva
            ? varianteDeNueva(nueva, productos, variantes)
            : null,
      grupo_nueva: nueva ? grupoDeNueva(nueva) : null,
      unidades: unidadesDeLinea(l.cantidad, packDe(l)),
      coste_total: costePorLinea.get(i)?.coste_total ?? 0,
    });
  });
  // Unidades por variante de lo ya casado: un punto más para la proforma que
  // trajo lo mismo.
  const unidadesCasadas = new Map<string, number>();
  for (const a of articulosFactura) {
    if (a.stock_id)
      unidadesCasadas.set(a.stock_id, (unidadesCasadas.get(a.stock_id) ?? 0) + a.unidades);
  }
  const sugerencias = sugerenciasDeProforma(
    conProformas,
    estado,
    {
      id: estado.id ?? null,
      proveedor: compra.proveedor,
      nif_proveedor: compra.nif_proveedor,
      proveedor_id: proveedorConocido?.id ?? null,
      fecha: compra.fecha,
      base: compra.base,
      total: compra.total,
      liquido: conTipos ? calculado.liquido : null,
      categoria: "textil",
      referencia_proforma: compra.referencia_proforma ?? null,
      unidades: unidadesCasadas.size > 0 ? unidadesCasadas : null,
    },
    todas as ProformaFila[],
  );
  const stockActual = useMemo(
    () =>
      new Map<string, StockActual>(
        (stock as Record<string, unknown>[]).map((s) => [
          String(s.id),
          { cantidad: Number(s.cantidad ?? 0), coste_unitario: Number(s.coste_unitario ?? 0) },
        ]),
      ),
    [stock],
  );
  const casadaCon = conProformas && estado.tipo_documento === "factura" && !!estado.proforma_id;
  const cabeceras = cabecerasLineaPapel(lineas);
  const partidas = partidasLineaPapel(lineas);

  const pendientes: string[] = [];
  if (duplicadoQueBloquea)
    pendientes.push(
      duplicadoQueBloquea.facturaDeProforma
        ? "Su factura ya está registrada."
        : "Ya está registrada.",
    );
  if (!duplicadoQueBloquea && porConfirmar.length > 0 && !estado.otraFactura)
    pendientes.push("¿Es un duplicado? Descártala o confirma que es otra factura.");
  if (!compra.fecha) pendientes.push("Falta la fecha de la factura.");
  if (sinProveedor) pendientes.push("Falta el proveedor (nombre o NIF).");
  if (sinDescripcion) pendientes.push("Hay líneas sin descripción.");
  // También en portes y descuentos: el reparto no mira su cantidad, pero el
  // registro la necesita mayor que cero.
  const sinCantidad = lineas.findIndex((l) => !(Number(l.cantidad) > 0));
  if (sinCantidad >= 0)
    pendientes.push(`Línea ${sinCantidad + 1}: la cantidad tiene que ser mayor que cero.`);
  if (faltan.length > 0)
    pendientes.push(
      `${faltan.length} línea${faltan.length === 1 ? "" : "s"} sin variante del almacén.`,
    );
  if (!reparto.ok) pendientes.push("El reparto no cuadra con la base.");
  if (conTipos && estado.tipo_iva === null) pendientes.push("Elige el tipo de IVA.");
  if (descuadreSinResolver) pendientes.push("El líquido no cuadra: elige cuál vale.");
  pendientes.push(...pendientesDeProforma(conProformas, estado, sugerencias));

  const registrar = () => {
    const envio: LineaEnvio[] = lineas.map((l, i) => {
      const e = efectivas[i];
      return {
        ...lineaEnvioSimple(l, null),
        stock_id: e.estado === "casada" ? e.stock_id : null,
        nueva_variante: e.estado === "nueva" ? e.nueva : null,
        casado_metodo:
          e.estado === "casada" ? e.metodo : e.estado === "nueva" ? ("nueva" as const) : null,
      };
    });
    onRegistrar({ proveedor_id: proveedorConocido?.id ?? null, lineas: envio });
  };

  const articulos = reparto.ok ? reparto.entradas.length : 0;
  const sumaCostes = reparto.ok ? sumarImportes(reparto.entradas, (e) => e.coste_total) : null;

  return (
    <DialogContent className="max-w-[min(96vw,90rem)] max-h-[92vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {esProformaRev
            ? "Revisar la proforma antes de dar de alta el género"
            : "Revisar la compra textil antes de darla de alta"}
        </DialogTitle>
        <DialogDescription>
          {esProformaRev
            ? "No cuenta en el IVA ni en Gerencia; su factura se casa con ella cuando llegue. "
            : ""}
          Lo que se registre entra en el libro de stock y no se puede borrar. Comprueba las
          cantidades y a qué variante del almacén va cada línea.
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {sinProveedor ? (
          <span className="text-muted-foreground">
            Escribe el proveedor o su NIF: la memoria del escáner va por proveedor.
          </span>
        ) : !memoriaAlDia ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando el proveedor…
          </span>
        ) : proveedorConocido ? (
          <span>
            <Badge variant="secondary" className="mr-1">
              Proveedor conocido
            </Badge>
            {proveedorConocido.nombre} · {proveedorConocido.compras} compra
            {proveedorConocido.compras === 1 ? "" : "s"} · {entradasMemoria.length} referencia
            {entradasMemoria.length === 1 ? "" : "s"} aprendida
            {entradasMemoria.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-muted-foreground">
            Proveedor nuevo: se dará de alta al registrar.
          </span>
        )}
        {onCambiarCategoria && (
          <Button
            variant="link"
            size="sm"
            className="ml-auto h-auto p-0"
            onClick={onCambiarCategoria}
          >
            Cambiar categoría
          </Button>
        )}
      </div>

      <Table movil="tarjetas" className="md:min-w-[1180px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Tipo</TableHead>
            <TableHead className="min-w-48">Descripción</TableHead>
            <TableHead className="w-28">Referencia</TableHead>
            <TableHead className="w-24">Color</TableHead>
            <TableHead className="w-20">Talla</TableHead>
            <TableHead className="w-36">EAN</TableHead>
            <TableHead className="w-20 text-right">Cantidad</TableHead>
            <TableHead className="w-20 text-right">Uds/pack</TableHead>
            <TableHead className="w-20 text-right">Unidades</TableHead>
            <TableHead className="w-28 text-right">Importe</TableHead>
            <TableHead className="w-28 text-right">Coste entrada / ud.</TableHead>
            <TableHead className="min-w-56">Variante</TableHead>
            <TableHead aria-label="Quitar" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineas.length === 0 && (
            <TableRow>
              <TableCell colSpan={13} className="text-center py-6 text-muted-foreground">
                Sin líneas. Añade una para dar género de alta.
              </TableCell>
            </TableRow>
          )}
          {lineas.map((l, i) => {
            const tipo = tipoDe(l);
            const esArticulo = tipo === "articulo";
            const e = efectivas[i];
            const coste = costePorLinea.get(i);
            const cabecera = cabeceras.get(i);
            const partida = partidas.get(i);
            const marca = clasesPartida(partida);
            return (
              <Fragment key={i}>
                {cabecera && <FilaLineaPapel grupo={cabecera} lineas={lineas} columnas={13} />}
                <TableRow className={`align-top ${marca.fila}`}>
                  <TableCell className={marca.celda}>
                    <EtiquetaPartida partida={partida} talla={l.talla} />
                    <Select
                      value={tipo}
                      onValueChange={(v) => setLinea(i, { tipo: v as TipoLineaCompra })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_LINEA_COMPRA.map((t) => (
                          <SelectItem key={t} value={t}>
                            {ETIQUETAS_TIPO_LINEA[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.descripcion}
                      onChange={(ev) => setLinea(i, { descripcion: ev.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.referencia ?? ""}
                      disabled={!esArticulo}
                      onChange={(ev) => setLinea(i, { referencia: ev.target.value || null })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.color ?? ""}
                      disabled={!esArticulo}
                      onChange={(ev) => setLinea(i, { color: ev.target.value || null })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.talla ?? ""}
                      disabled={!esArticulo}
                      onChange={(ev) => setLinea(i, { talla: ev.target.value || null })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="numeric"
                      value={l.ean ?? ""}
                      disabled={!esArticulo}
                      onChange={(ev) => setLinea(i, { ean: ev.target.value || null })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="any"
                      className="text-right"
                      value={l.cantidad}
                      onChange={(ev) => setLinea(i, { cantidad: Number(ev.target.value) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      className="text-right"
                      value={packDe(l)}
                      disabled={!esArticulo}
                      onChange={(ev) =>
                        setLinea(i, {
                          unidades_por_pack: Number(ev.target.value) || 1,
                          pack_deducido: false,
                        })
                      }
                    />
                    {e.estado === "casada" &&
                      e.packMemoria !== null &&
                      e.packMemoria !== 1 &&
                      packDe(l) === 1 &&
                      !l.pack_deducido && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs whitespace-normal text-left"
                          onClick={() =>
                            setLinea(i, {
                              unidades_por_pack: e.packMemoria ?? 1,
                              pack_deducido: false,
                            })
                          }
                        >
                          Pack de la memoria: {numeroJusto(e.packMemoria)} uds · usar
                        </Button>
                      )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {esArticulo ? numeroJusto(unidadesDeLinea(l.cantidad, packDe(l))) : "—"}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="any"
                      className="text-right"
                      value={l.importe}
                      onChange={(ev) => setLinea(i, { importe: Number(ev.target.value) })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {coste ? eurUnitario(coste.coste_unitario) : "—"}
                  </TableCell>
                  <TableCell>
                    <CeldaVariante
                      efectiva={e}
                      porId={porId}
                      onAceptar={(stock_id) => ponerEleccion(i, { tipo: "sugerencia", stock_id })}
                      onAuto={() => ponerEleccion(i, { tipo: "auto" })}
                      onElegir={() => setEligiendo(i)}
                      onCrear={() => setCreando([i])}
                      eleccion={eleccionDe(i)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Quitar la línea"
                      aria-label="Quitar la línea"
                      onClick={() => quitarLinea(i)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
        {lineas.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={9} className="font-semibold">
                Total · {lineas.length} línea{lineas.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {eur(sumarImportes(lineas, (x) => x.importe))}
              </TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableFooter>
        )}
      </Table>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={anadirLinea}>
          <Plus className="h-4 w-4 mr-1" /> Añadir línea
        </Button>
        {faltan.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setCreando(faltan)}>
            Crear las variantes que faltan ({faltan.length})
          </Button>
        )}
      </div>

      <div
        className={`rounded-md border p-3 text-sm space-y-1 ${
          reparto.ok ? "" : "border-destructive/50 bg-destructive/5"
        }`}
      >
        {reparto.ok ? (
          <>
            <p>
              Portes, descuentos y otros: {eurConSigno(reparto.aRepartir)} repartidos entre{" "}
              {articulos} artículo{articulos === 1 ? "" : "s"} por{" "}
              {reparto.criterio === "importe" ? "importe" : "unidades"}
            </p>
            <p className="font-medium">
              Coste de entrada {eur(sumaCostes)} = base {eur(reparto.base)}{" "}
              <span className="text-status-completado">✓</span>
            </p>
          </>
        ) : (
          reparto.errores.map((err, k) => (
            <p key={k} className="text-destructive">
              {mensajeErrorEscaner(err)}
            </p>
          ))
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Campo
          etiqueta="Base imponible"
          tipo="number"
          valor={String(compra.base)}
          onChange={(v) => set({ base: Number(v) })}
        />
        {conTipos && (
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
                    {`${Math.round(t * 100)} %`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Campo
          etiqueta={conTipos ? `IVA según ${esProformaRev ? "la proforma" : "la factura"}` : "IVA"}
          tipo="number"
          valor={String(compra.iva)}
          onChange={(v) => set({ iva: Number(v) })}
        />
        <Campo
          etiqueta={
            conTipos ? `Total según ${esProformaRev ? "la proforma" : "la factura"}` : "Total"
          }
          tipo="number"
          valor={String(compra.total)}
          onChange={(v) => set({ total: Number(v) })}
        />
      </div>
      {conTipos && (
        <p className="text-sm text-muted-foreground">
          La base calculará: IVA {eur(calculado.cuotaIva)} · total {eur(calculado.total)} ·{" "}
          <span className="font-medium text-foreground">líquido {eur(calculado.liquido)}</span>
        </p>
      )}
      {descuadre !== null && (
        <Card className="border-amber-500/50">
          <CardContent className="space-y-3 py-4 text-sm">
            <p className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              La factura dice {eur(compra.total)} a pagar y el cálculo da {eur(calculado.liquido)} (
              {descuadre > 0 ? "+" : ""}
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

      {conProformas && estado.tipo_documento === "factura" && (
        <CasarProforma
          sugerencias={sugerencias}
          proformaId={estado.proforma_id}
          sinProforma={!!estado.sinProforma}
          onElegir={(proforma_id) => onCambiar({ ...estado, proforma_id, sinProforma: false })}
          onNinguna={() =>
            onCambiar({ ...estado, proforma_id: null, sinProforma: !estado.sinProforma })
          }
          liquidoFactura={conTipos ? calculado.liquido : compra.total}
          textil={{
            articulos: reparto.ok ? articulosFactura : null,
            stock: stockActual,
            base: compra.base,
            etiqueta: (id) => {
              const v = porId.get(id);
              return v ? etiquetaVariante(v) : "Variante que no está en el almacén";
            },
          }}
        />
      )}

      {!estado.id && (
        <FicheroRevision
          fichero={estado.fichero ?? null}
          onCambiar={(fichero) => onCambiar({ ...estado, fichero })}
        />
      )}

      <DialogFooter className="items-center gap-3">
        {pendientes.length > 0 && (
          <span
            className={`text-sm mr-auto ${duplicadoQueBloquea ? "text-destructive" : "text-muted-foreground"}`}
          >
            {pendientes[0]}
            {pendientes.length > 1 && ` (y ${pendientes.length - 1} más)`}
          </span>
        )}
        <Button onClick={registrar} disabled={registrando || pendientes.length > 0}>
          {registrando ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : casadaCon ? (
            <FileText className="h-4 w-4 mr-2" />
          ) : (
            <PackageCheck className="h-4 w-4 mr-2" />
          )}
          {casadaCon
            ? "Registrar factura (regulariza el stock)"
            : "Registrar y dar de alta en el stock"}
        </Button>
      </DialogFooter>

      {eligiendo !== null && lineas[eligiendo] && (
        <SelectorStockTextil
          open
          onOpenChange={(o) => !o && setEligiendo(null)}
          modo="una"
          variantes={variantes}
          textoInicial={textoBusqueda(lineas[eligiendo])}
          onElegir={(v: VarianteCatalogo) => {
            ponerEleccion(eligiendo, { tipo: "manual", stock_id: v.id });
            setEligiendo(null);
          }}
        />
      )}
      {creando && (
        <CrearVarianteDialog
          open
          onOpenChange={(o) => !o && setCreando(null)}
          lineas={lineasParaCrear(creando)}
          productos={productos}
          catalogo={variantes}
          onGuardar={(r) => {
            const elecciones = todasLasElecciones();
            for (const { indice, nueva } of r) elecciones[indice] = { tipo: "nueva", nueva };
            onCambiar({
              ...estado,
              elecciones,
              asignaciones: estado.asignaciones.map((a, j) =>
                r.some((x) => x.indice === j) ? null : a,
              ),
            });
          }}
        />
      )}
    </DialogContent>
  );
}

/** La columna «Variante» de una línea: cómo está casada y qué se puede hacer. */
function CeldaVariante({
  efectiva,
  eleccion,
  porId,
  onAceptar,
  onAuto,
  onElegir,
  onCrear,
}: {
  efectiva: Efectiva;
  eleccion: Eleccion;
  porId: ReadonlyMap<string, VarianteCatalogo>;
  onAceptar: (stock_id: string) => void;
  onAuto: () => void;
  onElegir: () => void;
  onCrear: () => void;
}) {
  const etiqueta = (id: string) => {
    const v = porId.get(id);
    return v ? etiquetaVariante(v) : "Variante que no está en el almacén";
  };
  if (efectiva.estado === "no_aplica") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        No va al stock
      </Badge>
    );
  }
  const acciones = (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={onElegir}
      >
        Elegir…
      </Button>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={onCrear}
      >
        {efectiva.estado === "nueva" ? "Cambiar la variante nueva" : "Crear variante"}
      </Button>
      {eleccion.tipo !== "auto" && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={onAuto}
        >
          Volver al casado automático
        </Button>
      )}
    </div>
  );
  if (efectiva.estado === "nueva") {
    const n = efectiva.nueva;
    return (
      <div className="space-y-1">
        <Badge className="bg-blue-600 hover:bg-blue-600">Nueva</Badge>
        <p className="text-xs">
          {[n.producto?.marca, n.producto?.nombre, n.color, n.talla].filter(Boolean).join(" · ") ||
            "Variante nueva"}
        </p>
        {acciones}
      </div>
    );
  }
  if (efectiva.estado === "casada") {
    return (
      <div className="space-y-1">
        <Badge className="bg-emerald-600 hover:bg-emerald-600">
          {ETIQUETA_METODO[efectiva.metodo]}
        </Badge>
        <p className="text-xs">{etiqueta(efectiva.stock_id)}</p>
        {acciones}
      </div>
    );
  }
  if (efectiva.estado === "sugerida") {
    return (
      <div className="space-y-1">
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          Sugerencia
        </Badge>
        <div className="flex flex-col gap-1">
          {efectiva.casado.sugerencias.map((s) => (
            <Button
              key={s.stock_id}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto justify-start whitespace-normal py-1 text-left text-xs"
              title={s.motivo}
              onClick={() => onAceptar(s.stock_id)}
            >
              {etiqueta(s.stock_id)} · {s.puntos} puntos
            </Button>
          ))}
        </div>
        {acciones}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Badge variant="destructive">Sin casar</Badge>
      {acciones}
    </div>
  );
}

/** Los duplicados y los motivos de la cola: qué mirar antes de registrar. */
export function TarjetaQueMirar({
  motivos,
  duplicados,
  conId,
  otraFactura,
  onDescartar,
  onOtraFactura,
}: {
  motivos: string | null;
  duplicados: Duplicado[];
  /** Viene de la cola (se puede descartar). */
  conId: boolean;
  otraFactura: boolean;
  onDescartar: () => void;
  onOtraFactura: () => void;
}) {
  if (!motivos && duplicados.length === 0) return null;
  const duplicadoQueBloquea = duplicados.find(bloqueaRegistro);
  const porConfirmar = duplicados.filter((d) => !bloqueaRegistro(d) && !d.borrada);
  return (
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
            {bloqueaRegistro(d) && !d.facturaDeProforma && " No se puede registrar dos veces."}
          </p>
        ))}
        {String(motivos ?? "")
          .split("\n")
          .filter(
            (m) =>
              m &&
              !m.startsWith("Este fichero") &&
              !m.startsWith("Esta factura") &&
              !m.startsWith("Esta proforma"),
          )
          .filter((m) => !m.startsWith("Posible duplicado"))
          .map((m, i) => (
            <p key={i} className="text-muted-foreground">
              {m}
            </p>
          ))}
        {duplicados.length > 0 && conId && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" onClick={onDescartar}>
              Es la misma: descartar
            </Button>
            {porConfirmar.length > 0 && !duplicadoQueBloquea && (
              <Button
                type="button"
                size="sm"
                variant={otraFactura ? "default" : "outline"}
                onClick={onOtraFactura}
              >
                {porConfirmar.every((d) => d.facturaDeProforma)
                  ? "No es de esa factura"
                  : "Es otra factura"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * El fichero de la factura que se va a registrar. Se guarda al registrar; sin
 * él se puede registrar igual (un recibo que no llegó, una compra antigua) y
 * adjuntarlo después desde la lista.
 */
export function FicheroRevision({
  fichero,
  onCambiar,
}: {
  fichero: File | null;
  onCambiar: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 min-w-0 truncate">
        {fichero ? (
          <>
            Se guardará el fichero <span className="font-medium">{fichero.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Sin fichero. Puedes adjuntarlo ahora o después desde la lista.
          </span>
        )}
      </span>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onCambiar(f);
        }}
      />
      <Button size="sm" variant="outline" onClick={() => ref.current?.click()}>
        {fichero ? "Cambiar" : "Adjuntar fichero"}
      </Button>
      {fichero && (
        <Button size="sm" variant="ghost" onClick={() => onCambiar(null)}>
          Quitar
        </Button>
      )}
    </div>
  );
}

export function Campo({
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
