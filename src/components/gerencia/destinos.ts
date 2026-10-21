import { eur, fechaCorta, numero } from "@/lib/format";
import { TIENDA_TEXTIL } from "@/dominio/cobros";
import { escribirSeleccion, type Seleccion } from "@/dominio/periodos";
import type { Aviso, FiltroGerencia } from "@/dominio/gerencia";
import type { MovimientoCaja } from "@/lib/caja.functions";
import type { DatosGerencia as DatosGerenciaDominio } from "@/dominio/gerencia-datos";

/** Todo lo que leen las pestañas (ver dominio/gerencia-datos.ts). */
export type DatosGerencia = DatosGerenciaDominio<MovimientoCaja>;

export type Destino = { to: string; search?: Record<string, string> };

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

/** La ficha del cliente, buscada por su nombre en su pantalla de clientes. */
export function destinoCliente(c: { canal: string; nombre: string }): Destino {
  return {
    to: c.canal === "textil" ? "/panel/textil/clientes" : "/panel/clientes",
    search: { q: c.nombre },
  };
}

/** Los presupuestos enviados de una tienda o del textil, de cualquier fecha. */
export function destinoPresupuestos(tiendaId: string): Destino {
  return {
    to:
      tiendaId === TIENDA_TEXTIL.id
        ? "/panel/textil/presupuestos"
        : `/panel/tiendas/${tiendaId}/presupuestos`,
    search: { estado: "enviado" },
  };
}

/** Los pedidos en un estado, de cualquier fecha, con los filtros de tienda y canal. */
export function destinoPedidosEstado(f: FiltroGerencia, estado: string): Destino {
  if (esTextil(f)) return { to: "/panel/textil/pedidos", search: { estado } };
  return {
    to: "/panel/pedidos",
    search: {
      periodo: "todo",
      estado,
      ...(f.tienda !== "todas" ? { tienda: f.tienda } : {}),
      ...(f.canal === "web" || f.canal === "manual" ? { origen: f.canal } : {}),
    },
  };
}

export const DESTINO_AJUSTES: Destino = { to: "/panel/gerencia", search: { pestana: "ajustes" } };

export const DESTINO_CONCILIACION: Destino = { to: "/panel/conciliacion" };

/**
 * Las proformas que esperan su factura, de todas las categorías, en Compras (general): el
 * aviso de Gerencia y los anticipos de Tesorería cuentan todas. Textil › Compras solo lista
 * las textiles.
 */
export const DESTINO_PROFORMAS_PENDIENTES: Destino = {
  to: "/panel/compras",
  search: { documento: "proformas_pendientes" },
};

/** El texto de cada aviso. Las cifras van formateadas como en el resto del CRM. */
export function textoAviso(a: Aviso, frente?: string): string {
  switch (a.tipo) {
    case "deuda_antigua":
      return `${a.pedidos} ${a.pedidos === 1 ? "pedido debe" : "pedidos deben"} ${eur(a.importe)} desde hace más de 60 días.`;
    case "caida_ventas":
      return `Lo vendido cae un ${numero(a.porcentaje, 1)} %${frente ? ` frente a ${frente}` : ""}.`;
    case "web_sin_pagar":
      return `${a.pedidos} ${a.pedidos === 1 ? "pedido web está" : "pedidos web están"} sin pagar (${eur(a.importe)}). ${a.cuentan ? "Cuentan" : "No cuentan"} en lo vendido (se cambia en Ajustes).`;
    case "banco_sin_casar":
      return `${a.movimientos} ${a.movimientos === 1 ? "entrada del banco está" : "entradas del banco están"} sin casar con una factura (${eur(a.importe)}).`;
    case "proforma_sin_factura": {
      const antigua = a.masAntigua
        ? `; la más antigua, del ${fechaCorta(a.masAntigua)}${a.dias !== null ? ` (${a.dias} ${a.dias === 1 ? "día" : "días"})` : ""}`
        : "";
      return `${a.proformas} ${a.proformas === 1 ? "proforma" : "proformas"} sin factura (${eur(a.importe)})${antigua}.`;
    }
  }
}

export function destinoAviso(a: Aviso, d: DatosGerencia): Destino {
  switch (a.tipo) {
    case "deuda_antigua":
      return destinoPendientes(d.filtro);
    case "banco_sin_casar":
      return DESTINO_CONCILIACION;
    case "proforma_sin_factura":
      return DESTINO_PROFORMAS_PENDIENTES;
    default:
      return destinoPedidos(d.filtro, d.seleccion);
  }
}
