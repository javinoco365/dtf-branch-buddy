// «¿Quién eres?»: qué socios usan cada cuenta de acceso (tabla socio_cuentas,
// migración 20261115100000).
//
// Todo va con la sesión del usuario (`context.supabase`): la RLS deja a cada
// cuenta leer sus filas y a quien ve la empresa, todas; escribir solo lo hace
// socio_cuentas_fijar(), que exige admin y fija el autor de la auditoría. No
// hace falta la clave de servicio.
//
// Si la migración aún no está aplicada, se lee como «sin socios» (el CRM no
// pregunta a nadie) y guardar avisa de que falta.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PersonaCuenta } from "@/dominio/quien-soy";
import { exigeAdmin } from "./permisos-middleware";
import { faltaLaFuncion, faltaLaTabla, llamarRpcConError, tabla } from "./rpc";

const MIGRACION = "20261115100000_socio_cuentas";

type SocioFila = { nombre: string; activo: boolean | null; orden: number | null } | null;

/** Los socios de mi cuenta, activos y en el orden de Ajustes > Caja. */
export const misPersonas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ personas: PersonaCuenta[] }> => {
    const { data, error } = await tabla(context.supabase, "socio_cuentas")
      .select("socio_id, caja_socios(nombre, activo, orden)")
      .eq("usuario_id", context.userId);
    if (faltaLaTabla(error)) return { personas: [] };
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as { socio_id: string; caja_socios: SocioFila }[];
    const personas = filas
      .filter((f) => f.caja_socios && f.caja_socios.activo !== false)
      .sort(
        (a, b) =>
          (a.caja_socios!.orden ?? 0) - (b.caja_socios!.orden ?? 0) ||
          a.caja_socios!.nombre.localeCompare(b.caja_socios!.nombre, "es"),
      )
      .map((f) => ({ id: f.socio_id, nombre: f.caja_socios!.nombre }));
    return { personas };
  });

export type SocioConCuenta = {
  id: string;
  nombre: string;
  activo: boolean;
  /** La cuenta con la que entra, o null si no tiene. */
  usuario_id: string | null;
};

/** Para Ajustes > Usuarios: todos los socios y con qué cuenta entra cada uno. */
export const sociosYCuentas = createServerFn({ method: "GET" })
  .middleware([exigeAdmin])
  .handler(async ({ context }): Promise<{ socios: SocioConCuenta[]; falta_migracion: boolean }> => {
    const [socios, enlaces] = await Promise.all([
      tabla(context.supabase, "caja_socios")
        .select("id, nombre, activo, orden")
        .order("orden")
        .order("nombre"),
      tabla(context.supabase, "socio_cuentas").select("socio_id, usuario_id"),
    ]);
    if (socios.error) throw new Error(socios.error.message);
    const falta = faltaLaTabla(enlaces.error);
    if (enlaces.error && !falta) throw new Error(enlaces.error.message);
    const cuentaDe = new Map(
      ((enlaces.data ?? []) as { socio_id: string; usuario_id: string }[]).map((e) => [
        e.socio_id,
        e.usuario_id,
      ]),
    );
    return {
      socios: ((socios.data ?? []) as { id: string; nombre: string; activo: boolean | null }[]).map(
        (s) => ({
          id: s.id,
          nombre: s.nombre,
          activo: s.activo !== false,
          usuario_id: cuentaDe.get(s.id) ?? null,
        }),
      ),
      falta_migracion: falta,
    };
  });

/** Deja una cuenta con exactamente estos socios. Un socio de otra cuenta pasa a esta. */
export const fijarSociosDeCuenta = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d) =>
    z
      .object({
        cuenta: z.string().uuid(),
        socios: z.array(z.string().uuid()).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await llamarRpcConError<string[]>(context.supabase, "socio_cuentas_fijar", {
      _usuario_id: context.userId,
      _cuenta: data.cuenta,
      _socios: [...new Set(data.socios)],
    });
    if (faltaLaFuncion(error)) {
      throw new Error(
        `Falta aplicar la migración ${MIGRACION} en la base para guardar quién usa cada cuenta`,
      );
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });
