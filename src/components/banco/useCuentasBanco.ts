import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCuentas } from "@/lib/banco.functions";

/** Las cuentas del banco y los últimos extractos. */
export function useCuentasBanco() {
  const fn = useServerFn(listCuentas);
  return useQuery({ queryKey: ["banco-cuentas"], queryFn: () => fn() });
}
