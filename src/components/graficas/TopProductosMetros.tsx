// Gráfica en fichero propio: solo se carga con import() (React.lazy), para
// que la librería de gráficas no retrase las cifras de la pantalla. No
// importar de forma normal (ver src/arquitectura/importaciones-mixtas.test.ts).
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { metros } from "@/lib/format";

/** Los productos con más metros, en barras horizontales. */
export function TopProductosMetros({ datos }: { datos: { producto: string; metros: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} layout="vertical" margin={{ left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v} m`} />
        <YAxis type="category" dataKey="producto" width={140} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(v: number) => metros(v)}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
          }}
        />
        <Bar dataKey="metros" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
