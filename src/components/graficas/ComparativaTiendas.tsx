// Gráfica en fichero propio: solo se carga con import() (React.lazy), para
// que la librería de gráficas no retrase las cifras de la pantalla. No
// importar de forma normal (ver src/arquitectura/importaciones-mixtas.test.ts).
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { eur } from "@/lib/format";

/** Lo cobrado por cada tienda, una barra de un color por tienda. */
export function ComparativaTiendas({
  datos,
  colores,
}: {
  datos: { tienda: string; total: number }[];
  colores: readonly string[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="tienda" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <Tooltip
          formatter={(v: number) => eur(v)}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
          }}
        />
        <Bar dataKey="total" name="Total cobrado" radius={[6, 6, 0, 0]}>
          {datos.map((_, i) => (
            <Cell key={i} fill={colores[i % colores.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
