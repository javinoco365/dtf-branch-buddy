import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { diaDeMadrid, msHastaMananaEnMadrid, resumenDe } from "@/dominio/agenda";
import { leerAgenda } from "@/lib/agenda.functions";
import { useQuienSoy } from "@/hooks/use-quien-soy";

/** Clave de React Query de la Agenda: tareas, categorías y personas. */
export const CLAVE_AGENDA = ["agenda"] as const;

/** Hoy, en Madrid ('yyyy-mm-dd'). */
export function hoyEnMadrid(): string {
  return diaDeMadrid(new Date());
}

/**
 * Hoy, en Madrid, y que cambie solo: a medianoche (un temporizador hasta las
 * 00:00 de Madrid) y al volver a la pestaña (el temporizador se duerme si el
 * ordenador se suspende).
 */
export function useHoyEnMadrid(): string {
  const [hoy, setHoy] = useState(hoyEnMadrid);
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const actualizar = () => {
      setHoy(hoyEnMadrid());
      clearTimeout(temporizador);
      // Un segundo de margen: que al despertar ya sea el día siguiente.
      temporizador = setTimeout(actualizar, msHastaMananaEnMadrid(new Date()) + 1000);
    };
    const alVolver = () => {
      if (document.visibilityState === "visible") actualizar();
    };
    actualizar();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      clearTimeout(temporizador);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, []);
  return hoy;
}

/**
 * Los datos de la Agenda. Los comparten la pantalla y el contador del menú: se
 * piden una vez. Tras guardar se refrescan solos (src/lib/cache.ts), y cada
 * cinco minutos para que se vea lo que manden los demás.
 */
export function useAgenda() {
  const leer = useServerFn(leerAgenda);
  return useQuery({
    queryKey: CLAVE_AGENDA,
    queryFn: () => leer(),
    refetchInterval: 5 * 60_000,
  });
}

/**
 * Mis tareas de hoy, vencidas o nuevas, y por qué no se saben si no se saben:
 * leyéndose, sin poder leerse o sin saber quién eres. Antes salía 0 en los
 * tres casos, como si no hubiera nada que hacer.
 */
export type AvisoAgenda = {
  /** Cuántas; nulo si no se sabe. */
  aviso: number | null;
  cargando: boolean;
  error: Error | null;
  /** Por qué no se sabe sin ser un error: falta elegir quién eres, o no hay nadie. */
  motivo: string | null;
  reintentar: () => void;
};

export function useEstadoAvisoAgenda(): AvisoAgenda {
  const agenda = useAgenda();
  const quien = useQuienSoy();
  const hoy = useHoyEnMadrid();
  const { data, error, refetch } = agenda;
  const { persona } = quien;
  const aviso = useMemo(
    () => (data && persona ? resumenDe(data.tareas, persona.id, hoy).aviso : null),
    [data, persona, hoy],
  );
  return {
    aviso,
    cargando: (data === undefined && !error) || quien.cargando,
    error: (error as Error | null) ?? quien.error,
    motivo:
      quien.cargando || quien.error || persona
        ? null
        : quien.estado.tipo === "elegir"
          ? "Elige quién eres"
          : "Nadie dado de alta en la Agenda",
    reintentar: () => {
      if (error) void refetch();
      if (quien.error) quien.reintentar();
    },
  };
}

/** El número del menú: mis tareas de hoy, vencidas o nuevas. Nulo si no se sabe (sin insignia). */
export function useAvisoAgenda(): number | null {
  return useEstadoAvisoAgenda().aviso;
}
