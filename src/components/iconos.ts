import {
  BadgePercent,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Coins,
  Euro,
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
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { ClaveIcono } from "@/dominio/navegacion";

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
  usuarios: Users,
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
  caja: ICONOS_PANTALLA.caja,
  propinas: Gift,
  presupuestos: ICONOS_PANTALLA.presupuestos,
  /** Género en el almacén (stock). */
  almacen: ICONOS_PANTALLA.stock,
  inversion: ICONOS_PANTALLA.inversion,
} as const satisfies Record<string, LucideIcon>;
