import {
  Ban,
  BadgePercent,
  Building,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  Coins,
  CreditCard,
  Euro,
  Factory,
  FilePen,
  FileText,
  FileUp,
  FolderArchive,
  Gauge,
  Gift,
  HandCoins,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Percent,
  PiggyBank,
  Receipt,
  ReceiptEuro,
  ReceiptText,
  Ruler,
  Scale,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  Truck,
  Undo2,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { ClaveIcono } from "@/dominio/navegacion";
import type { ClaveConcepto, ClaveDato } from "@/dominio/cuenta";

/**
 * Un concepto, un icono, en toda la aplicación.
 *
 * Antes `Receipt` era a la vez Facturación y Pedidos, `Wallet` era Cobros
 * pendientes, Cobrado y Caja, y los metros salían con una regla o con una caja
 * según la pantalla. Aquí se decide una vez: el menú y las tarjetas de cifras
 * usan este mapa, así que el icono de «Cobrado» en Inicio es el mismo que el de
 * «Lo cobrado» en el menú.
 */

/** Las pantallas del menú (src/dominio/navegacion.ts). */
export const ICONOS_PANTALLA: Record<ClaveIcono, LucideIcon> = {
  inicio: LayoutDashboard,
  gerencia: Gauge,
  "cuenta-resultados": ChartNoAxesCombined,
  agenda: CalendarDays,
  pedidos: ShoppingCart,
  clientes: Users,
  productos: Package,
  cobros: Wallet,
  cobrado: HandCoins,
  compras: ReceiptText,
  banco: Landmark,
  caja: Coins,
  inversion: PiggyBank,
  archivo: FolderArchive,
  presupuestos: FilePen,
  facturas: FileText,
  facturacion: Receipt,
  ajustes: Settings,
  usuarios: UserCog,
  tiendas: Building2,
  stock: Boxes,
  "compras-textil": FileUp,
  novedades: Sparkles,
};

/** Las cifras de las tarjetas. Lo que también es una pantalla, con su icono. */
export const ICONO = {
  /** Facturación, ventas, facturado, base imponible. */
  ventas: ICONOS_PANTALLA.facturacion,
  /** Lo vendido: ventas netas, «Vendido». */
  vendido: Euro,
  /** Ventas con IVA y portes: lo que paga el cliente. */
  ventasConIva: ReceiptEuro,
  pedidos: ICONOS_PANTALLA.pedidos,
  ticketMedio: Tag,
  metros: Ruler,
  margen: Percent,
  /** Beneficio y margen neto: lo que queda. */
  beneficio: TrendingUp,
  iva: BadgePercent,
  /** Lo cobrado. */
  cobrado: ICONOS_PANTALLA.cobrado,
  /** Lo que falta por cobrar. */
  pendienteCobro: ICONOS_PANTALLA.cobros,
  /** Lo que debemos a proveedores. */
  pendientePago: CreditCard,
  propinas: Gift,
  presupuestos: ICONOS_PANTALLA.presupuestos,
  /** Género en el almacén (stock). */
  almacen: ICONOS_PANTALLA.stock,
  portes: Truck,
  devoluciones: Undo2,
  produccion: Factory,
  estructura: Building,
  impuesto: Scale,
  beneficioNeto: CircleDollarSign,
  cancelados: Ban,
} as const satisfies Record<string, LucideIcon>;

/**
 * El icono de cada cifra de la cuenta de resultados (dominio/cuenta.ts). Las
 * tarjetas lo sacan de aquí por su clave: no se elige en cada pantalla.
 */
export const ICONO_CONCEPTO: Record<ClaveConcepto, LucideIcon> = {
  ventas_con_iva: ICONO.ventasConIva,
  iva: ICONO.iva,
  portes_cobrados: ICONO.portes,
  ventas: ICONO.ventas,
  devoluciones: ICONO.devoluciones,
  ventas_netas: ICONO.vendido,
  coste_produccion: ICONO.produccion,
  resultado_portes: ICONO.portes,
  margen_bruto: ICONO.margen,
  gastos_estructura: ICONO.estructura,
  beneficio_antes_impuestos: ICONO.beneficio,
  sociedades: ICONO.impuesto,
  beneficio_neto: ICONO.beneficioNeto,
  cobrado: ICONO.cobrado,
  pendiente_cobro: ICONO.pendienteCobro,
  pendiente_pago: ICONO.pendientePago,
};

/** El icono de cada dato que no es dinero (DATOS de dominio/cuenta.ts). */
export const ICONO_DATO: Record<ClaveDato, LucideIcon> = {
  pedidos: ICONO.pedidos,
  metros: ICONO.metros,
  metros_uv: ICONO.metros,
  ticket_medio: ICONO.ticketMedio,
  cancelados: ICONO.cancelados,
};
