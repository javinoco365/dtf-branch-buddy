import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { diaDeMadrid, resumenDe } from "@/dominio/agenda";
import { leerAgenda } from "@/lib/agenda.functions";
import { useQuienSoy } from "@/hooks/use-quien-soy";

/** Clave de React Query de la Agenda: tareas, categorías y personas. */
export const CLAVE_AGENDA = ["agenda"] as const;

/** Hoy, en Madrid ('yyyy-mm-dd'). */
export function hoyEnMadrid(): string {
  return diaDeMadrid(new Date());
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

/** El número del menú: mis tareas de hoy, vencidas o nuevas. Sin persona, 0. */
export function useAvisoAgenda(): number {
  const { data } = useAgenda();
  const { persona } = useQuienSoy();
  return useMemo(
    () => (data && persona ? resumenDe(data.tareas, persona.id, hoyEnMadrid()).aviso : 0),
    [data, persona],
  );
}
