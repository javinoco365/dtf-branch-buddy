import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { eur, numero } from "@/lib/format";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { escribirSeleccion, type Comparacion, type Seleccion } from "@/dominio/periodos";
import type { CobroConsolidado } from "@/dominio/facturacion";
import type { PedidoPendiente } from "@/dominio/pendientes";
import type { Aviso, FiltroGerencia, MovimientoBancoResumen, Venta } from "@/dominio/gerencia";
import type { MovimientoCaja } from "@/lib/caja.functions";

/** Todo lo que leen las pestañas, ya filtrado por tienda y canal. */
export type DatosGerencia = {
  filtro: FiltroGerencia;
  seleccion: Seleccion;
  rango: { desde: Date; hasta: Date };
  comparacion: Comparacion | null;
  costeMetro: number;
  tiendas: readonly { id: string; nombre: string }[];
  ventas: Venta[];
  ventasPrevias: Venta[];
  cobros: CobroConsolidado[];
  cobrosPrevios: CobroConsolidado[];
  cobrosDisponibles: boolean;
  pendientes: PedidoPendiente[];
  pendientesDisponibles: boolean;
  caja: MovimientoCaja[] | undefined;
  banco: MovimientoBancoResumen[] | undefined;
  hoy: Date;
};

type Destino = { to: string; search?: Record<string, string> };

/** El periodo elegido, como lo entienden las demás pantallas en su dirección. */
function periodoEnDireccion(sel: Seleccion): Record<string, string> {
  return Object.fromEntries(Object.entries(escribirSeleccion(sel)).filter(([, v]) => v !== ""));
}

const esTextil = (f: FiltroGerencia) => f.canal === "textil" || f.tienda === TIENDA_TEXTIL.id;

/** Los pedidos de lo que se está mirando, con el mismo periodo y los mismos filtros. */
export function destinoPedidos(f: FiltroGerencia, sel: Seleccion): Destino {
  const periodo = periodoEnDireccion(sel);
  if (esTextil(f)) return { to: "/panel/textil/pedidos", search: periodo };
  return {
    to: "/panel/pedidos",
    search: {
      ...periodo,
      ...(f.tienda !== "todas" ? { tienda: f.tienda } : {}),
      ...(f.canal === "web" || f.canal === "manual" ? { origen: f.canal } : {}),
    },
  };
}

/** Los cobros del periodo, en la Facturación Consolidada por fecha de cobro. */
export function destinoCobros(f: FiltroGerencia, sel: Seleccion): Destino {
  return {
    to: "/panel/facturacion-global",
    search: {
      ...periodoEnDireccion(sel),
      criterio: "cobro",
      ...(f.tienda !== "todas" ? { tienda: f.tienda } : {}),
    },
  };
}

/** Lo que se debe hoy, en Cobros pendientes. */
export function destinoPendientes(f: FiltroGerencia): Destino {
  return {
    to: "/panel/cobros",
    search: {
      ...(f.tienda !== "todas" ? { tienda: f.tienda } : {}),
      ...(f.canal !== "todos" ? { origen: f.canal } : {}),
    },
  };
}

export function destinoCaja(sel: Seleccion): Destino {
  return { to: "/panel/caja", search: periodoEnDireccion(sel) };
}

export const DESTINO_CONCILIACION: Destino = { to: "/panel/conciliacion" };

/** «Ver detalle →», a la pantalla con la lista que hay detrás de una cifra. */
export function VerDetalle({
  destino,
  texto = "Ver detalle",
}: {
  destino: Destino;
  texto?: string;
}) {
  return (
    <Link
      to={destino.to as never}
      search={destino.search as never}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {texto} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

/** El texto de cada aviso. Las cifras van formateadas como en el resto del CRM. */
export function textoAviso(a: Aviso, frente?: string): string {
  switch (a.tipo) {
    case "deuda_antigua":
      return `${a.pedidos} ${a.pedidos === 1 ? "pedido debe" : "pedidos deben"} ${eur(a.importe)} desde hace más de 60 días.`;
    case "caida_ventas":
      return `Lo vendido cae un ${numero(a.porcentaje, 1)} %${frente ? ` frente a ${frente}` : ""}.`;
    case "web_sin_pagar":
      return `${a.pedidos} ${a.pedidos === 1 ? "pedido web está" : "pedidos web están"} sin pagar (${eur(a.importe)}). Cuentan en lo vendido.`;
    case "banco_sin_casar":
      return `${a.movimientos} ${a.movimientos === 1 ? "entrada del banco está" : "entradas del banco están"} sin casar con una factura (${eur(a.importe)}).`;
  }
}

export function destinoAviso(a: Aviso, d: DatosGerencia): Destino {
  switch (a.tipo) {
    case "deuda_antigua":
      return destinoPendientes(d.filtro);
    case "banco_sin_casar":
      return DESTINO_CONCILIACION;
    default:
      return destinoPedidos(d.filtro, d.seleccion);
  }
}
