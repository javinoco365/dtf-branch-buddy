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
        <CartesianGrid {...REJILLA} />
        <XAxis {...EJE} dataKey="tienda" tick={{ ...TEXTO_EJE, fontSize: 12 }} />
        <YAxis
          {...EJE}
          tick={TEXTO_EJE}
          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <Tooltip {...BOCADILLO} formatter={(v: number) => eur(v)} />
        <Bar dataKey="total" name="Total cobrado" radius={[6, 6, 0, 0]}>
          {datos.map((_, i) => (
            <Cell key={i} fill={colores[i % colores.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
