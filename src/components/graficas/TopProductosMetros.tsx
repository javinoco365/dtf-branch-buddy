import { metros } from "@/lib/format";

/**
 * Los productos que más metros llevan, como lista con su barra.
 *
 * Antes era una gráfica de barras horizontales: con uno o dos productos (lo
 * normal en una imprenta de DTF) salía una barra gigante que no decía nada, y
 * el nombre del producto se cortaba en el eje. Una lista se lee igual con uno
 * que con seis, y la cifra va escrita.
 */
export function TopProductosMetros({ datos }: { datos: { producto: string; metros: number }[] }) {
  const maximo = Math.max(...datos.map((d) => d.metros), 0);
  return (
    <ol className="space-y-3">
      {datos.map((d, i) => (
        <li key={d.producto} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={d.producto}>
              <span className="mr-2 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              {d.producto}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{metros(d.metros)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-primary/10" aria-hidden>
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${maximo > 0 ? (d.metros / maximo) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
