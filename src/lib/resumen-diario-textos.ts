import { format, getQuarter } from "date-fns";
import { es } from "date-fns/locale";
import { rangoDe, type Seleccion } from "@/dominio/periodos";
import { eur, metros, numero } from "@/lib/format";
import type { AvisoResumen } from "@/dominio/resumen-diario";

/** 0,734 → «73 %». */
export const porcentaje = (v: number | null | undefined) =>
  v == null ? "—" : `${numero(v * 100, 0)} %`;

/** 11,5 → «11,5 h»; más de dos días, en días. */
export const horas = (h: number | null) =>
  h == null ? "—" : h >= 48 ? `${numero(h / 24, 1)} días` : `${numero(h, 1)} h`;

const pedidos = (n: number | undefined) => `${n ?? 0} ${n === 1 ? "pedido" : "pedidos"}`;

/** El texto de un aviso del Resumen. */
export function textoAvisoResumen(a: AvisoResumen): string {
  switch (a.tipo) {
    case "margen_negativo":
      return `Margen neto negativo (${eur(a.importe)}): se está vendiendo por debajo de lo que cuesta producir y enviar.`;
    case "maquina_llena":
      return `La máquina ha ido al ${porcentaje(a.porcentaje)} de su capacidad: no cabe más sin alargar la jornada.`;
    case "cola_larga":
      return `Quedan ${metros(a.metros)} en cola, más de un día de máquina (${metros(a.capacidadDia)}).`;
    case "realizados_sin_cobrar":
      return `${pedidos(a.cantidad)} hechos y sin cobrar del todo: ${eur(a.importe)}.`;
    case "envios_en_perdida":
      return `Los envíos cuestan ${eur(a.importe)} más de lo que se cobra por ellos.`;
    case "fuera_de_hora":
      return `${pedidos(a.cantidad)} entraron a las ${a.hora} o después: se hacen al día siguiente.`;
    case "maquina_con_sitio":
      return `La máquina ha ido al ${porcentaje(a.porcentaje)}: hay sitio para vender más.`;
    case "envios_estimados":
      return `${pedidos(a.cantidad)} con envío sin coste real apuntado: se estiman a ${eur(a.importe)} cada uno.`;
    case "sin_fecha_realizado":
      return `${pedidos(a.cantidad)} enviados sin fecha de realizado: no cuentan en los metros realizados.`;
  }
}

/** «5 de octubre de 2026». */
const diaLargo = (d: Date) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es });

/** «del 5 al 11 de octubre de 2026», «del 28 de septiembre al 4 de octubre de 2026». */
function delAl(desde: Date, hasta: Date): string {
  if (desde.getFullYear() !== hasta.getFullYear()) {
    return `del ${diaLargo(desde)} al ${diaLargo(hasta)}`;
  }
  if (desde.getMonth() !== hasta.getMonth()) {
    return `del ${format(desde, "d 'de' MMMM", { locale: es })} al ${diaLargo(hasta)}`;
  }
  return `del ${format(desde, "d", { locale: es })} al ${diaLargo(hasta)}`;
}

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Cómo se llama el informe y su periodo, escrito entero: «Informe semanal»,
 * «Semana del 5 al 11 de octubre de 2026».
 */
export function tituloInforme(sel: Seleccion): { tipo: string; titulo: string } {
  const r = rangoDe(sel);
  switch (sel.tipo) {
    case "hoy":
      return {
        tipo: "Informe diario",
        titulo: mayuscula(format(sel.ref, "EEEE d 'de' MMMM 'de' yyyy", { locale: es })),
      };
    case "semana":
      return { tipo: "Informe semanal", titulo: `Semana ${delAl(r!.desde, r!.hasta)}` };
    case "mes":
      return {
        tipo: "Informe mensual",
        titulo: mayuscula(format(sel.ref, "LLLL 'de' yyyy", { locale: es })),
      };
    case "trimestre":
      return {
        tipo: "Informe trimestral",
        titulo: `${getQuarter(sel.ref)}.º trimestre de ${sel.ref.getFullYear()}`,
      };
    case "anio":
      return { tipo: "Informe anual", titulo: `Año ${sel.ref.getFullYear()}` };
    default:
      return {
        tipo: "Informe del periodo",
        titulo: r ? mayuscula(delAl(r.desde, r.hasta)) : "Todo",
      };
  }
}
