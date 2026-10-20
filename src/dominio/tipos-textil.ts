/**
 * Tipos compartidos del escáner textil, el catálogo y el almacén. Los usan el
 * dominio, el servidor, la interfaz y las cuentas: si cambia uno, cambia en
 * docs/escaner-textil/contrato.md en el mismo commit.
 */

export const TIPOS_LINEA_COMPRA = ["articulo", "porte", "descuento", "otro"] as const;
export type TipoLineaCompra = (typeof TIPOS_LINEA_COMPRA)[number];
export const ETIQUETAS_TIPO_LINEA: Record<TipoLineaCompra, string> = {
  articulo: "Artículo",
  porte: "Porte",
  descuento: "Descuento",
  otro: "Otro cargo",
};

export const MOTIVOS_STOCK = [
  "inicial",
  "compra",
  "venta",
  "devolucion_cliente",
  "devolucion_proveedor",
  "ajuste_inventario",
  "merma",
  "ajuste_coste",
] as const;
export type MotivoStock = (typeof MOTIVOS_STOCK)[number];

/** Qué documento es una compra: la proforma no es documento fiscal (decisión 3). */
export const TIPOS_DOCUMENTO_COMPRA = ["factura", "proforma"] as const;
export type TipoDocumentoCompra = (typeof TIPOS_DOCUMENTO_COMPRA)[number];
export const ETIQUETAS_TIPO_DOCUMENTO: Record<TipoDocumentoCompra, string> = {
  factura: "Factura",
  proforma: "Proforma",
};

export const METODOS_CASADO = [
  "memoria",
  "ean",
  "referencia",
  "sugerencia",
  "manual",
  "nueva",
] as const;
export type MetodoCasado = (typeof METODOS_CASADO)[number];

export type Proveedor = { id: string; nombre: string; nif: string | null; activo: boolean };

export type ProductoTextil = {
  id: string;
  marca: string | null;
  referencia: string | null;
  nombre: string;
  categoria: string | null;
  activo: boolean;
};

/** Una variante de textil_stock lista para casar, elegir o valorar. */
export type VarianteCatalogo = {
  id: string;
  producto_id: string | null;
  producto: ProductoTextil | null;
  nombre: string;
  sku: string | null;
  ean: string | null;
  color: string | null;
  talla: string | null;
  categoria: string | null;
  /** Físico. */
  cantidad: number;
  cantidad_reservada: number;
  cantidad_minima: number;
  coste_unitario: number;
  precio_venta: number;
  activa: boolean;
  repetida: boolean;
};

export type EntradaMemoria = {
  id: string;
  clave: string;
  stock_id: string;
  unidades_por_pack: number;
  veces: number;
};

/** Lo que hace falta de una línea de factura para casarla. */
export type LineaParaCasar = {
  tipo: TipoLineaCompra;
  descripcion: string;
  referencia: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  ean: string | null;
};

export type Sugerencia = { stock_id: string; puntos: number; motivo: string };

export type Casado =
  | {
      estado: "casada";
      stock_id: string;
      metodo: "memoria" | "ean" | "referencia";
      /** El pack que aprendió la memoria; nulo si no viene de ella. */
      unidades_por_pack: number | null;
    }
  | { estado: "sugerida"; sugerencias: Sugerencia[] }
  | { estado: "sin_casar" }
  | { estado: "no_aplica" };

/** Variante que se crea al registrar la compra. */
export type NuevaVariante = {
  /** Producto existente; si es nulo, se busca o se crea con `producto`. */
  producto_id: string | null;
  producto: {
    marca: string | null;
    referencia: string | null;
    nombre: string;
    categoria: string | null;
  } | null;
  color: string | null;
  talla: string | null;
  ean: string | null;
  sku: string | null;
  /** Lo pone Javier. 0 si todavía no. */
  precio_venta: number;
  cantidad_minima: number;
};

/** Una línea tal como la recibe textil_compra_guardar_y_registrar. */
export type LineaRegistro = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
  unidad: string | null;
  tipo: TipoLineaCompra;
  referencia: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  ean: string | null;
  unidades_por_pack: number;
  stock_id: string | null;
  nueva_variante: NuevaVariante | null;
  casado_metodo: MetodoCasado | null;
  /** Solo artículos de compras textil (los calcula repartirCostes). */
  unidades_stock: number | null;
  coste_total_entrada: number | null;
  coste_unitario_entrada: number | null;
  /** Número de la línea del papel de la que sale (líneas partidas por talla); null si no. */
  linea_papel?: number | null;
};

/**
 * El JSON `_compra` de textil_compra_guardar_y_registrar.
 *
 * Las claves opcionales, si no vienen, conservan en una compra que ya existe
 * (un borrador de la cola) lo que tenía: el concepto y el IRPF leídos, la nota
 * con el fichero… Si vienen, aunque sea nulas, mandan.
 */
export type RegistroCompra = {
  id: string | null;
  empresa_id: string | null;
  proveedor_id: string | null;
  proveedor: string | null;
  nif_proveedor: string | null;
  numero: string | null;
  fecha: string | null;
  base: number;
  iva: number;
  irpf?: number;
  total: number;
  categoria: string;
  gasto_id?: string | null;
  tipo_iva: number | null;
  tipo_irpf: number | null;
  liquido_origen: "calculado" | "factura" | null;
  nota_descuadre?: string | null;
  concepto?: string | null;
  forma_pago?: string | null;
  notas?: string | null;
  lectura_ia: unknown;
  lineas: LineaRegistro[];
  /** Sin la clave, "factura". */
  tipo_documento?: TipoDocumentoCompra;
  /** La proforma con la que se casa esta factura (solo facturas). */
  proforma_id?: string | null;
};

export type ResultadoRegistro = {
  id: string;
  movidas: number;
  variantes_creadas: number;
  aprendidas: number;
  proveedor_id: string | null;
  proveedor_nuevo: boolean;
  tipo_documento: TipoDocumentoCompra;
  proforma_id: string | null;
  casado: ResumenCasado | null;
};

/** Una variante en la regularización (SQL 1.7 c4 y regularizacionPrevista). */
export type FilaRegularizacion = {
  /** O "nueva:<indice>", solo en la previsión. */
  stock_id: string;
  unidades_proforma: number;
  unidades_factura: number;
  coste_unitario_proforma: number | null;
  coste_unitario_factura: number | null;
  entran: number;
  salen: number;
  unidades_ajustadas: number;
  importe_ajuste: number;
  importe_sin_aplicar: number;
};

export type RegularizacionStock = {
  variantes: FilaRegularizacion[];
  entran: number;
  salen: number;
  valor_proforma: number;
  valor_entradas: number;
  /** ≤ 0. */
  valor_devoluciones: number;
  importe_ajustes: number;
  diferencia_sin_aplicar: number;
  movimientos: number;
};

export type PagoTraspasado = {
  enlaces_movidos: number;
  grupos: number;
  grupos_revisar: number;
  /** El de la factura tras casar. */
  estado_pago: "pendiente" | "pagada";
  fecha_pago: string | null;
  /** Si la proforma estaba pagada. */
  proforma_pagada?: boolean;
  /** (liquido ?? total) de la proforma, al céntimo. */
  liquido_proforma?: number;
  /** líquido de la factura − liquido_proforma. */
  diferencia?: number;
};

/** textil_compras.casado_resumen de la factura casada, y `casado` del resultado del registro. */
export type ResumenCasado = {
  proforma_id: string;
  /** null si no es textil. */
  stock: RegularizacionStock | null;
  pago: PagoTraspasado;
};

/** Una línea de presupuesto o pedido textil en pantalla. */
export type LineaDocumentoTextil = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_pct: number;
  stock_id?: string | null;
  /** El coste congelado que trae la línea guardada; solo para enseñar. */
  coste_unit_snapshot?: number | null;
  /**
   * Solo en el editor: el precio no se sabe (un borrador de la IA sin precio
   * en el texto ni en el stock). No se guarda hasta que alguien lo escriba,
   * aunque sea 0 a propósito. No se manda al servidor.
   */
  precio_pendiente?: boolean;
};

export type Partida = { unidades: number; valor: number };

/** Los ids de la tabla 1.4 que puede dar también el dominio. */
export type CodigoErrorEscaner =
  | "E-REG-8"
  | "E-REG-9"
  | "E-REG-10"
  | "E-REG-13" // «Línea %: un porte no puede ser negativo ni un descuento positivo.»
  | "E-REG-14"
  | "E-REP-1" // «Línea %: el descuento deja el artículo en negativo; revisa el descuento.»
  | "E-EAN-1"; // «Línea %: el EAN % no es válido.»

/** Un error del dominio, sin texto: el texto lo pone mensajeErrorEscaner (3.1). */
export type ErrorEscaner = {
  /** Posición (0…n−1) de la línea; null si es de la factura entera. */
  linea: number | null;
  codigo: CodigoErrorEscaner;
  /** Los números y textos que van en el mensaje, en crudo y en orden. */
  datos: (number | string)[];
};
