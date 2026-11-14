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
import { BOCADILLO, EJE, REJILLA, TEXTO_EJE } from "@/components/graficas/estilo";
import { eur } from "@/lib/format";

/** Lo cobrado cada semana; la última, la actual, en color lleno. */
export function CobradoPorSemana({ datos }: { datos: { semana: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos}>
        <CartesianGrid {...REJILLA} />
        <XAxis
          {...EJE}
          dataKey="semana"
          tick={{ ...TEXTO_EJE, fontSize: 10 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={50}
        />
        <YAxis
          {...EJE}
          tick={TEXTO_EJE}
          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <Tooltip {...BOCADILLO} formatter={(v: number) => eur(v)} />
        <Bar dataKey="total" radius={[6, 6, 0, 0]}>
          {datos.map((_, i) => (
            <Cell
              key={i}
              fill="var(--color-primary)"
              fillOpacity={i === datos.length - 1 ? 1 : 0.55}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
