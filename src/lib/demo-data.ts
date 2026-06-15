import { eachDayOfInterval } from "date-fns";

export const TIENDAS_DEMO = ["DTF Pro", "Print&Go", "TextilDTF"] as const;
export const PRODUCTOS_DEMO = [
  "DTF Premium 60cm",
  "DTF Económico 60cm",
  "DTF Glitter 30cm",
  "DTF Reflectante",
  "DTF Glow 60cm",
  "DTF UV",
];

export type PedidoDemo = {
  fecha: Date;
  tienda: string;
  bruto: number;
  iva: number;
  envio: number;
  total: number;
  metros: number;
  estado: "completado" | "procesando" | "cancelado";
  producto: string;
};

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function generarPedidosRango(desde: Date, hasta: Date): PedidoDemo[] {
  const out: PedidoDemo[] = [];
  const dias = eachDayOfInterval({ start: desde, end: hasta });
  for (const dia of dias) {
    const key = `${dia.getFullYear()}-${dia.getMonth() + 1}-${dia.getDate()}`;
    const dow = dia.getDay();
    const factor = dow === 0 || dow === 6 ? 0.5 : 1;
    const n = Math.floor(3 + hash(key) * 9 * factor);
    for (let i = 0; i < n; i++) {
      const seed = `${key}-${i}`;
      const r = hash(seed);
      const r2 = hash(seed + "x");
      const tienda = TIENDAS_DEMO[Math.floor(r * TIENDAS_DEMO.length)];
      const producto = PRODUCTOS_DEMO[Math.floor(r2 * PRODUCTOS_DEMO.length)];
      const mts = Number((2 + r * 18).toFixed(2));
      const precioM = 8 + r2 * 6;
      const bruto = Number((mts * precioM).toFixed(2));
      const envio = r2 < 0.3 ? 0 : Number((3 + r2 * 4).toFixed(2));
      const iva = Number((bruto * 0.21).toFixed(2));
      const total = Number((bruto + iva + envio).toFixed(2));
      const estado: PedidoDemo["estado"] =
        r2 < 0.06 ? "cancelado" : r < 0.15 ? "procesando" : "completado";
      out.push({ fecha: dia, tienda, bruto, iva, envio, total, metros: mts, estado, producto });
    }
  }
  return out;
}

export function descargarCSV(nombre: string, filas: (string | number)[][]) {
  const csv = filas
    .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}