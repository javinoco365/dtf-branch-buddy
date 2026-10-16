import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ambitoDeClave,
  normalizarPlantilla,
  resolverIdentidad,
} from "@/dominio/plantilla-presupuesto";
import { descargarLogo } from "@/lib/logo-descarga";
import { generarPresupuestoPDF, type PresupuestoPDFData } from "@/lib/pdf-presupuesto";
import { vistaPreviaPresupuestoTienda } from "@/lib/presupuestos.functions";
import { vistaPreviaPresupuestoTextil } from "@/lib/textil.functions";
import type { Borrador } from "./editor";

/** Lo que tarda en rehacerse el PDF desde el último cambio. */
const PAUSA_MS = 400;

/**
 * La vista previa del PDF de verdad, con la plantilla que se está editando.
 *
 * Del servidor llegan los datos del último presupuesto del ámbito (o uno sin
 * líneas si no hay ninguno) y la identidad de la tienda o de la marca. Aquí se
 * les pone el nombre, el color y el logo que resultan de la plantilla, el logo
 * se descarga en el navegador y el PDF se genera con el mismo generador que
 * los presupuestos, cada vez que la plantilla deja de cambiar un momento.
 */
export function useVistaPrevia({
  clave,
  borrador,
}: {
  clave: string | null;
  borrador: Borrador | null;
}) {
  const ambito = clave ? ambitoDeClave(clave) : null;
  const deTienda = useServerFn(vistaPreviaPresupuestoTienda);
  const deTextil = useServerFn(vistaPreviaPresupuestoTextil);

  const vista = useQuery({
    queryKey: ["plantilla-presupuesto-vista", clave],
    queryFn: () =>
      ambito?.ambito === "tienda" ? deTienda({ data: { tiendaId: ambito.tiendaId } }) : deTextil(),
    enabled: !!ambito,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  // El nombre, el logo y el color que salen: los de la plantilla, o los de la
  // tienda o la marca que manda el servidor.
  const plantilla = borrador?.plantilla ?? null;
  const identidad =
    borrador && vista.data
      ? resolverIdentidad(borrador.plantilla, borrador.logo_url, vista.data.base)
      : null;

  const urlLogo = identidad?.logo_url ?? null;
  const logo = useQuery({
    queryKey: ["plantilla-presupuesto-logo", urlLogo],
    queryFn: () => descargarLogo(urlLogo),
    enabled: !!urlLogo,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const esperandoLogo = !!urlLogo && logo.isFetching;

  // Los datos del presupuesto con la identidad de la plantilla. Mientras baja
  // el logo, nada: así no se ve un PDF sin logo un instante.
  const hayIdentidad = !!identidad;
  const nombre = identidad?.nombre_comercial ?? "";
  const color = identidad?.color ?? null;
  const datos = useMemo<PresupuestoPDFData | null>(() => {
    if (!vista.data || !hayIdentidad || esperandoLogo) return null;
    const d = vista.data.datos;
    return {
      ...d,
      emisor: { ...d.emisor, nombre_comercial: nombre },
      color,
      logo: urlLogo ? (logo.data ?? null) : null,
    };
  }, [vista.data, hayIdentidad, nombre, color, urlLogo, logo.data, esperandoLogo]);

  // El PDF va con el ámbito del que es: al cambiar de tienda no se enseña el de la anterior.
  const [pdf, setPdf] = useState<{ url: string; blob: Blob; clave: string | null } | null>(null);
  const [generando, setGenerando] = useState(false);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);
  const turno = useRef(0);
  const urlActual = useRef<string | null>(null);

  useEffect(() => {
    if (!datos || !plantilla) {
      // Sin datos (cargando, o con error) no hay nada que generar.
      turno.current++;
      setGenerando(false);
      return;
    }
    const mio = ++turno.current;
    setGenerando(true);
    const t = setTimeout(async () => {
      try {
        const blob = await generarPresupuestoPDF(datos, normalizarPlantilla(plantilla));
        if (mio !== turno.current) return;
        const url = URL.createObjectURL(blob);
        // El PDF anterior ya no hace falta: fuera de memoria.
        if (urlActual.current) URL.revokeObjectURL(urlActual.current);
        urlActual.current = url;
        setPdf({ url, blob, clave });
        setErrorPdf(null);
      } catch (e) {
        if (mio !== turno.current) return;
        setErrorPdf(e instanceof Error ? e.message : "No se pudo generar la vista previa");
      } finally {
        if (mio === turno.current) setGenerando(false);
      }
    }, PAUSA_MS);
    return () => clearTimeout(t);
  }, [datos, plantilla, clave]);

  useEffect(
    () => () => {
      if (urlActual.current) URL.revokeObjectURL(urlActual.current);
    },
    [],
  );

  const pdfActual = pdf && pdf.clave === clave ? pdf : null;
  return {
    /** Lo que devuelve el servidor: datos, identidad de base y número del presupuesto. */
    vista,
    pdf: pdfActual,
    generando: generando || esperandoLogo || (vista.isSuccess && !pdfActual && !errorPdf),
    errorPdf,
    /**
     * El logo no se ha podido traer al navegador (otro servidor sin permiso
     * para leerlo desde aquí, o un formato que el PDF no admite): la vista
     * previa sale sin él.
     */
    logoFallido: !!urlLogo && logo.isFetched && !logo.isFetching && !logo.data,
  };
}
