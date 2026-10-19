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
