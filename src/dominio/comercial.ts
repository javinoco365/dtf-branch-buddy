/**
 * Gerencia › Comercial: presupuestos enviados, aceptados y pendientes.
 *
 * Junta los presupuestos de las tiendas y los del textil. Los del textil
 * tienen un estado más, «facturado», que para el embudo es un aceptado.
 *
 * Lógica pura: se prueba sin base de datos.
 */

import { redondear } from "./importes";
import { validoHasta } from "./presupuestos";
import { diaLocal } from "./facturacion";
import { diasDesde } from "./pendientes";

type Numerico = number | string | null | undefined;
const num = (v: Numerico) => Number(v ?? 0) || 0;

export type PresupuestoResumen = {
  id: string;
  numero: string;
  /** `yyyy-MM-dd`. */
  fecha: string;
  estado: string;
  total: Numerico;
  validez_dias: number;
  cliente_nombre: string | null;
  /** La tienda, o TIENDA_TEXTIL.id para el textil. */
  tienda_id: string;
  /** Fecha del pedido creado desde el presupuesto, si se confirmó. */
  fecha_pedido?: string | null;
};

const ACEPTADO = new Set(["aceptado", "facturado"]);
const ENVIADO = new Set(["enviado", "aceptado", "rechazado", "facturado"]);

/** Un número de presupuestos y lo que suman, con IVA. */
export type Cuenta = { n: number; importe: number };

export type EmbudoPresupuestos = {
  /** Todos los del periodo, también los borradores. */
  creados: Cuenta;
  borradores: Cuenta;
  /** Los que llegaron al cliente: enviados, aceptados, rechazados y facturados. */
  enviados: Cuenta;
  aceptados: Cuenta;
  rechazados: Cuenta;
  /** Enviados sin respuesta todavía, estén en plazo o caducados. */
  sinRespuesta: Cuenta;
  /** Aceptados ÷ enviados, en número de presupuestos (%). */
  conversion: number | null;
  /** Lo mismo, en importe (%). */
  conversionImporte: number | null;
  /** Días de media del presupuesto al pedido, de los que se confirmaron. */
  diasAPedido: { media: number; n: number } | null;
};

const vacia = (): Cuenta => ({ n: 0, importe: 0 });
const sumar = (c: Cuenta, p: PresupuestoResumen) => {
  c.n += 1;
  c.importe += num(p.total);
};
const cerrar = (c: Cuenta): Cuenta => ({ n: c.n, importe: redondear(c.importe) });

/** Días entre dos fechas (día local), nunca negativos. */
function diasEntre(desde: string, hasta: string): number {
  const [a, m, d] = diaLocal(hasta).split("-").map(Number);
  return diasDesde(desde, new Date(a, m - 1, d));
}

/** El embudo de los presupuestos del periodo, por su fecha. */
export function embudoPresupuestos(lista: readonly PresupuestoResumen[]): EmbudoPresupuestos {
  const creados = vacia();
  const borradores = vacia();
  const enviados = vacia();
  const aceptados = vacia();
  const rechazados = vacia();
  const sinRespuesta = vacia();
  let dias = 0;
  let conPedido = 0;

  for (const p of lista) {
    sumar(creados, p);
    if (p.estado === "borrador") sumar(borradores, p);
    if (ENVIADO.has(p.estado)) sumar(enviados, p);
    if (ACEPTADO.has(p.estado)) sumar(aceptados, p);
    if (p.estado === "rechazado") sumar(rechazados, p);
    if (p.estado === "enviado") sumar(sinRespuesta, p);
    if (p.fecha_pedido) {
      dias += diasEntre(p.fecha, p.fecha_pedido);
      conPedido += 1;
    }
  }

  return {
    creados: cerrar(creados),
    borradores: cerrar(borradores),
    enviados: cerrar(enviados),
    aceptados: cerrar(aceptados),
    rechazados: cerrar(rechazados),
    sinRespuesta: cerrar(sinRespuesta),
    conversion: enviados.n > 0 ? redondear((aceptados.n / enviados.n) * 100, 1) : null,
    conversionImporte:
      enviados.importe > 0 ? redondear((aceptados.importe / enviados.importe) * 100, 1) : null,
    diasAPedido: conPedido > 0 ? { media: redondear(dias / conPedido, 1), n: conPedido } : null,
  };
}

export type PendientesPresupuesto = {
  /** Enviados y aún en plazo: lo que todavía puede entrar. */
  vigentes: Cuenta;
  /** Enviados con el plazo ya pasado y sin respuesta. */
  caducados: Cuenta;
  /** Los vigentes, de más a menos importe. */
  lista: (PresupuestoResumen & { validoHasta: string; diasRestantes: number })[];
};

/**
 * Los presupuestos enviados que siguen sin respuesta, a día de hoy. No
 * depende del periodo: es la foto de lo que está en el aire.
 */
export function presupuestosPendientes(
  lista: readonly PresupuestoResumen[],
  hoy: Date,
): PendientesPresupuesto {
  const vigentes = vacia();
  const caducados = vacia();
  const abiertos: PendientesPresupuesto["lista"] = [];
  const hoyTexto = fechaTexto(hoy);
  for (const p of lista) {
    if (p.estado !== "enviado") continue;
    const hasta = validoHasta(p.fecha, p.validez_dias);
    if (hasta < hoyTexto) {
      sumar(caducados, p);
      continue;
    }
    sumar(vigentes, p);
    const [a, m, d] = hasta.split("-").map(Number);
    const fin = new Date(a, m - 1, d);
    const hoyDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    abiertos.push({
      ...p,
      validoHasta: hasta,
      diasRestantes: Math.round((fin.getTime() - hoyDia.getTime()) / 86_400_000),
    });
  }
  abiertos.sort((a, b) => num(b.total) - num(a.total) || a.diasRestantes - b.diasRestantes);
  return { vigentes: cerrar(vigentes), caducados: cerrar(caducados), lista: abiertos };
}

function fechaTexto(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
