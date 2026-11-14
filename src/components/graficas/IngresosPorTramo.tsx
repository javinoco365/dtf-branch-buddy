// Gráfica en fichero propio: solo se carga con import() (React.lazy), para
// que la librería de gráficas no retrase las cifras de la pantalla. No
// importar de forma normal (ver src/arquitectura/importaciones-mixtas.test.ts).
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { BOCADILLO, EJE, REJILLA, TEXTO_EJE } from "@/components/graficas/estilo";
import { eur } from "@/lib/format";

/** Ingresos por día o por mes, en barras. */
export function IngresosPorTramo({
  datos,
  etiquetaConColor = false,
}: {
  datos: { dia: string; total: number }[];
  /** El texto de la etiqueta del recuadro con el color del tema (Dashboard). */
  etiquetaConColor?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos}>
        <CartesianGrid {...REJILLA} />
        <XAxis {...EJE} dataKey="dia" tick={TEXTO_EJE} interval="preserveStartEnd" />
        <YAxis
          {...EJE}
          tick={TEXTO_EJE}
          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <Tooltip
          {...BOCADILLO}
          formatter={(v: number) => eur(v)}
          labelStyle={etiquetaConColor ? { color: "var(--color-foreground)" } : undefined}
        />
        <Bar dataKey="total" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
