import { type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { pantallaActual } from "@/dominio/navegacion";
import { useTiendasMenu } from "@/hooks/use-tiendas-menu";
import { cn } from "@/lib/utils";

/**
 * La cabecera de cada pantalla del panel: el título (el único h1), una línea
 * opcional que explica la pantalla y, a la derecha, sus botones.
 *
 * El título sale por defecto de `pantallaActual()`, el mismo nombre que el menú
 * y que la cabecera de arriba, para que no vuelvan a separarse. En una tienda
 * se añade su nombre («Pedidos · Tienda Uno») y en el textil, «Textil». Se
 * puede pasar otro cuando la pantalla no está en el menú o necesita matiz.
 *
 * En el móvil los botones bajan debajo del título en vez de apretarse a su lado,
 * y en las subpantallas de Ajustes sin enlace de vuelta se ve encima de qué
 * cuelgan, porque la cabecera de arriba no tiene sitio para decirlo.
 */
export function CabeceraPantalla({
  titulo,
  subtitulo,
  acciones,
  antes,
  icono,
  id,
  tienda,
  className,
  children,
}: {
  /** Si no se pasa, el nombre del menú. */
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  /** Los botones de la pantalla. */
  acciones?: ReactNode;
  /** Algo encima del título, como un enlace para volver. */
  antes?: ReactNode;
  /** Un icono delante del título. */
  icono?: ReactNode;
  /** El id del h1, para `aria-labelledby`. */
  id?: string;
  /**
   * El nombre de la tienda, si la pantalla ya lo tiene (también las que no
   * salen en el menú por estar desactivadas). Si no, sale del menú.
   */
  tienda?: string | null;
  className?: string;
  /** Lo que va debajo del subtítulo: un selector, una nota. */
  children?: ReactNode;
}) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const idTienda = pathname.match(/^\/panel\/tiendas\/([^/]+)/)?.[1];
  const { data: tiendas } = useTiendasMenu();
  const nombreTienda = idTienda ? tienda || tiendas?.find((t) => t.id === idTienda)?.nombre : null;
  const pantalla = pantallaActual(pathname, nombreTienda);

  const nombre = titulo ?? pantalla?.titulo ?? "";
  // De quién es la pantalla, detrás del título: «Pedidos · Tienda Uno»,
  // «Stock · Textil». Así no se confunde con la pantalla general del mismo nombre.
  const deQuien = idTienda
    ? (nombreTienda ?? "Tienda")
    : pantalla?.seccion === "Textil"
      ? "Textil"
      : null;
  // Las subpantallas de Ajustes no están en el menú: en el móvil, donde la
  // cabecera de arriba solo cabe el nombre, se dice encima de qué cuelgan.
  const miga = pantalla?.seccion === "Ajustes" ? pantalla.seccion : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1 sm:basis-72">
        {antes}
        {miga && !antes && (
          <p className="text-xs font-medium text-muted-foreground md:hidden">{miga}</p>
        )}
        <h1 id={id} className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {icono}
          <span className="min-w-0">
            {nombre}
            {deQuien && <> · {deQuien}</>}
          </span>
        </h1>
        {subtitulo && <div className="text-sm text-muted-foreground">{subtitulo}</div>}
        {children}
      </div>
      {acciones && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {acciones}
        </div>
      )}
    </div>
  );
}
