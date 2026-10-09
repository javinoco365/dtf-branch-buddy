import * as React from "react";

import { cn } from "@/lib/utils";

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /**
   * «tarjetas»: por debajo de 768 px cada fila se pinta como una tarjeta, con
   * el nombre de la columna delante de cada dato (ver `.tabla-tarjetas` en
   * styles.css). En el ordenador la tabla no cambia en nada.
   */
  movil?: "tarjetas";
};

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, movil, ...props }, ref) => {
    const propia = React.useRef<HTMLTableElement | null>(null);
    const unirRef = React.useCallback(
      (el: HTMLTableElement | null) => {
        propia.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    React.useEffect(() => {
      if (movil !== "tarjetas" || !propia.current) return;
      const tabla = propia.current;
      ponerEtiquetas(tabla);
      // Las filas cambian al filtrar o al cargar: se vuelven a etiquetar.
      const obs = new MutationObserver(() => ponerEtiquetas(tabla));
      obs.observe(tabla, { childList: true, subtree: true, characterData: true });
      return () => obs.disconnect();
    }, [movil]);
    return (
      <div className="relative w-full overflow-auto">
        <table
          ref={unirRef}
          className={cn(
            "w-full caption-bottom text-sm",
            movil === "tarjetas" && "tabla-tarjetas",
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

/**
 * Copia el texto de cada cabecera a `data-etiqueta` en las celdas de su
 * columna, para que la tarjeta del móvil diga qué es cada dato. Una celda que
 * ocupa varias columnas, o cuya cabecera está vacía, se queda sin etiqueta.
 * Una celda con `data-etiqueta-fija` lleva esa en vez de la de su cabecera
 * (en un pie, cuando el dato no es lo que dice la columna).
 * Solo escribe si el valor cambia, para no despertar al MutationObserver en
 * bucle.
 */
function ponerEtiquetas(tabla: HTMLTableElement) {
  const cabecera = tabla.tHead?.rows[tabla.tHead.rows.length - 1];
  const nombres: string[] = [];
  if (cabecera) {
    for (const th of Array.from(cabecera.cells)) {
      const texto = th.textContent?.trim() ?? "";
      for (let i = 0; i < th.colSpan; i++) nombres.push(texto);
    }
  }
  const filas = [...Array.from(tabla.tBodies).flatMap((b) => Array.from(b.rows))];
  if (tabla.tFoot) filas.push(...Array.from(tabla.tFoot.rows));
  for (const fila of filas) {
    let columna = 0;
    for (const td of Array.from(fila.cells)) {
      const etiqueta =
        td.getAttribute("data-etiqueta-fija") ?? (td.colSpan > 1 ? "" : (nombres[columna] ?? ""));
      if (td.getAttribute("data-etiqueta") !== etiqueta) td.setAttribute("data-etiqueta", etiqueta);
      columna += td.colSpan;
    }
  }
}
