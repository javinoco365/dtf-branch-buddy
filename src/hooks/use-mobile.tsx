import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Si la ventana mide menos de `corte` píxeles de ancho (768 por omisión, el
 * `md:` de Tailwind). La barra lateral lo usa con 1280 (`xl:`): por debajo, el
 * menú es un cajón que se abre con el botón de la cabecera, para que en una
 * tablet (820 en vertical, 1180 en horizontal) el contenido tenga todo el ancho.
 */
export function useIsMobile(corte: number = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${corte - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < corte);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < corte);
    return () => mql.removeEventListener("change", onChange);
  }, [corte]);

  return !!isMobile;
}
