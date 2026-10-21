import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigeAdmin } from "./permisos-middleware";
import {
  ambitoDeClave,
  claveAmbito,
  normalizarPlantilla,
  type AmbitoPlantilla,
  type PlantillaPresupuesto,
} from "@/dominio/plantilla-presupuesto";
import { faltaLaColumna, faltaLaTabla, tabla } from "./rpc";
import { texto } from "./pdf-presupuesto-datos";

/**
 * Las plantillas del PDF de presupuestos: una por tienda y una para el textil.
 * Ver 20261026100000_plantillas_presupuesto.sql.
 *
 * Todo con la sesión del usuario (`context.supabase`): la RLS decide qué
 * tiendas ve y quién puede guardar (solo administradores). El autor de cada
 * cambio queda en la auditoría por auth.uid(). Aquí no se usa la clave de
 * servicio.
 */

/** Un ámbito en el editor: la tienda (o el textil) con su plantilla. */
export type AmbitoEditable = {
  /** «tienda:<id>» o «textil» (claveAmbito). */
  clave: string;
  /** Lo que se lee en el selector: el nombre de la tienda, o «Textil personalizado». */
  etiqueta: string;
  plantilla: PlantillaPresupuesto;
  /** El logo propio de la plantilla, si tiene. */
  logo_url: string | null;
  /** Si hay una plantilla guardada; si no, es la de por defecto. */
  guardada: boolean;
  /** Lo de la tienda o de la marca, que sale si la plantilla no lo cambia. */
  base: { nombre: string | null; logo_url: string | null; color: string | null };
};

type Identidad = AmbitoEditable["base"];

const SIN_IDENTIDAD: Identidad = { nombre: null, logo_url: null, color: null };

const SOLO_ADMIN = "Solo un administrador puede cambiar la plantilla";
const FALTA_MIGRACION =
  "Falta aplicar la migración 20261026100000_plantillas_presupuesto.sql para guardar plantillas";

/** Un error de Supabase como Error de JavaScript, con el mensaje en español si es de permisos. */
function errorDeEscritura(error: { code?: string; message: string }): Error {
  if (error.code === "42501") return new Error(SOLO_ADMIN);
  if (faltaLaTabla(error)) return new Error(FALTA_MIGRACION);
  return new Error(error.message);
}

// ---------------------------------------------------------------------------
// La empresa y la marca del textil
// ---------------------------------------------------------------------------

/**
 * La empresa activa (la primera por fecha de alta, como en el resto de la
 * aplicación) y la marca textil predeterminada que tenga apuntada.
 *
 * La marca predeterminada vive en empresas desde 20260903100000; antes, en
 * empresa_global. Si la base todavía no tiene la columna nueva, se lee de la
 * vieja.
 */
export async function leerEmpresaActiva(
  sb: unknown,
): Promise<{ id: string; marcaPredeterminada: string | null } | null> {
  const conMarca = await tabla(sb, "empresas")
    .select("id, textil_marca_predeterminada_id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!conMarca.error) {
    return conMarca.data
      ? {
          id: conMarca.data.id as string,
          marcaPredeterminada: texto(conMarca.data.textil_marca_predeterminada_id),
        }
      : null;
  }
  if (!faltaLaColumna(conMarca.error)) throw new Error(conMarca.error.message);

  const { data: empresa, error } = await tabla(sb, "empresas")
    .select("id")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!empresa) return null;
  const { data: global } = await tabla(sb, "empresa_global")
    .select("textil_marca_predeterminada_id")
    .limit(1)
    .maybeSingle();
  return {
    id: empresa.id as string,
    marcaPredeterminada: texto(global?.textil_marca_predeterminada_id),
  };
}

/**
 * El nombre, el logo y el color del textil cuando no hay un presupuesto
 * concreto: los de la marca predeterminada; si no hay ninguna apuntada (o ya
 * no existe), los de la primera marca activa por fecha de alta. Sin marcas,
 * vacío: el PDF sale con el nombre comercial de la plantilla, o sin él.
 */
export async function identidadTextil(
  sb: unknown,
  marcaPredeterminada: string | null,
): Promise<Identidad> {
  const deFila = (m: Record<string, unknown> | null | undefined): Identidad | null =>
    m ? { nombre: texto(m.nombre), logo_url: texto(m.logo_url), color: texto(m.color) } : null;

  if (marcaPredeterminada) {
    const { data, error } = await tabla(sb, "textil_marcas")
      .select("nombre, logo_url, color")
      .eq("id", marcaPredeterminada)
      .maybeSingle();
    if (error && !faltaLaTabla(error)) throw new Error(error.message);
    const marca = deFila(data);
    if (marca) return marca;
  }

  const { data, error } = await tabla(sb, "textil_marcas")
    .select("nombre, logo_url, color")
    .eq("activa", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error && !faltaLaTabla(error)) throw new Error(error.message);
  return deFila(data) ?? SIN_IDENTIDAD;
}

// ---------------------------------------------------------------------------
// El logo propio de la plantilla
// ---------------------------------------------------------------------------

const RUTA_LOGOS = "/storage/v1/object/public/logos/";
const LOGO_AJENO =
  "El logo tiene que estar subido desde el editor (almacenamiento de logos de este proyecto)";

/**
 * El logo de una plantilla solo puede ser un fichero del bucket público
 * «logos» de este proyecto de Supabase: el generador del PDF lo descarga desde
 * el servidor, y una dirección cualquiera haría que el servidor pidiera lo que
 * se le diga. Devuelve la dirección normalizada, o null si no hay logo.
 *
 * https siempre, salvo que el propio proyecto esté en localhost (el banco de
 * pruebas): ahí el origen es http y es el mismo.
 */
function logoDelProyecto(url: string | null): string | null {
  const limpia = url?.trim();
  if (!limpia) return null;

  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Falta SUPABASE_URL: no se puede comprobar de dónde viene el logo");

  let logo: URL;
  let proyecto: URL;
  try {
    logo = new URL(limpia);
    proyecto = new URL(base);
  } catch {
    throw new Error(LOGO_AJENO);
  }

  const proyectoLocal = proyecto.hostname === "localhost" || proyecto.hostname === "127.0.0.1";
  const esquemaValido = logo.protocol === "https:" || (proyectoLocal && logo.protocol === "http:");
  if (
    !esquemaValido ||
    logo.origin !== proyecto.origin ||
    logo.username !== "" ||
    logo.password !== "" ||
    // El parser ya ha resuelto «..» y «%2e%2e»: la ruta que queda es la de verdad.
    !logo.pathname.startsWith(RUTA_LOGOS) ||
    logo.pathname.length === RUTA_LOGOS.length
  ) {
    throw new Error(LOGO_AJENO);
  }
  return logo.href;
}

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------

type FilaPlantilla = {
  ambito: string;
  tienda_id: string | null;
  empresa_id: string;
  config: unknown;
  logo_url: string | null;
};

/** Las tiendas que ve el usuario y el textil, cada uno con su plantilla. */
export const listarPlantillasPresupuesto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ disponible: boolean; ambitos: AmbitoEditable[] }> => {
    const sb = context.supabase;

    // Las tiendas activas que deja ver la RLS: las suyas, o todas si es
    // administrador.
    const leerTiendas = async () => {
      let tiendas = await tabla(sb, "tiendas")
        .select("id, nombre, logo_url, color")
        .eq("activa", true)
        .order("nombre");
      if (faltaLaColumna(tiendas.error)) {
        tiendas = await tabla(sb, "tiendas").select("id, nombre, logo_url, color").order("nombre");
      }
      return tiendas;
    };
    const leerBaseTextil = async () => {
      const empresa = await leerEmpresaActiva(sb);
      return {
        empresa,
        baseTextil: await identidadTextil(sb, empresa?.marcaPredeterminada ?? null),
      };
    };
    // Todas las plantillas que ve, de una vez. Sin la migración, ninguna: el
    // editor enseña las de por defecto y avisa de que falta.
    const leerPlantillas = async () =>
      await tabla(sb, "plantillas_presupuesto").select(
        "ambito, tienda_id, empresa_id, config, logo_url",
      );

    // Las tres lecturas no dependen unas de otras: van a la vez. Los errores
    // se miran en el mismo orden que antes (tiendas, textil, plantillas).
    const [rTiendas, rBase, rPlantillas] = await Promise.allSettled([
      leerTiendas(),
      leerBaseTextil(),
      leerPlantillas(),
    ]);
    if (rTiendas.status === "rejected") throw rTiendas.reason;
    const tiendas = rTiendas.value;
    if (tiendas.error) throw new Error(tiendas.error.message);
    if (rBase.status === "rejected") throw rBase.reason;
    const { empresa, baseTextil } = rBase.value;
    if (rPlantillas.status === "rejected") throw rPlantillas.reason;
    const { data: filas, error } = rPlantillas.value;
    if (error && !faltaLaTabla(error)) throw new Error(error.message);
    const disponible = !error;
    const guardadas = (filas ?? []) as FilaPlantilla[];

    const ambito = (
      a: AmbitoPlantilla,
      etiqueta: string,
      base: Identidad,
      fila: FilaPlantilla | undefined,
    ): AmbitoEditable => ({
      clave: claveAmbito(a),
      etiqueta,
      plantilla: normalizarPlantilla(fila?.config, a.ambito),
      logo_url: texto(fila?.logo_url),
      guardada: !!fila,
      base,
    });

    const ambitos: AmbitoEditable[] = ((tiendas.data ?? []) as Array<Record<string, unknown>>).map(
      (t) =>
        ambito(
          { ambito: "tienda", tiendaId: t.id as string },
          texto(t.nombre) ?? "Tienda sin nombre",
          { nombre: texto(t.nombre), logo_url: texto(t.logo_url), color: texto(t.color) },
          guardadas.find((f) => f.ambito === "tienda" && f.tienda_id === t.id),
        ),
    );

    // La del textil es la de la empresa activa (hoy solo hay una).
    const filaTextil = guardadas.find(
      (f) => f.ambito === "textil" && (!empresa || f.empresa_id === empresa.id),
    );
    ambitos.push(ambito({ ambito: "textil" }, "Textil personalizado", baseTextil, filaTextil));

    return { disponible, ambitos };
  });

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

/** Guarda la plantilla de un ámbito (solo administradores: lo decide la RLS). */
export const guardarPlantillaPresupuesto = createServerFn({ method: "POST" })
  .middleware([exigeAdmin])
  .inputValidator((d: unknown) =>
    z
      .object({
        clave: z.string().min(1).max(64),
        config: z.unknown(),
        logo_url: z.string().url().max(2048).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sb = context.supabase;

    const ambito = ambitoDeClave(data.clave);
    if (!ambito) {
      throw new Error(
        "No se reconoce de quién es la plantilla: tiene que ser una tienda o el textil",
      );
    }

    // Nunca lo que llega tal cual: la plantilla completa, con cada valor dentro
    // de sus límites.
    const config = normalizarPlantilla(data.config, ambito.ambito);
    const logo_url = logoDelProyecto(data.logo_url);

    // La empresa: la de la tienda (si no la ve, no es suya) o la activa, en el
    // textil. En la de tienda la base la vuelve a poner por su cuenta.
    let empresaId: string;
    if (ambito.ambito === "tienda") {
      const { data: tienda, error } = await tabla(sb, "tiendas")
        .select("id, empresa_id")
        .eq("id", ambito.tiendaId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!tienda) throw new Error("Sin acceso a esta tienda");
      empresaId = tienda.empresa_id as string;
    } else {
      const empresa = await leerEmpresaActiva(sb);
      if (!empresa) throw new Error("No hay ninguna empresa activa configurada");
      empresaId = empresa.id;
    }

    const buscar = () => {
      const consulta = tabla(sb, "plantillas_presupuesto").select("id").eq("ambito", ambito.ambito);
      return (
        ambito.ambito === "tienda"
          ? consulta.eq("tienda_id", ambito.tiendaId)
          : consulta.is("tienda_id", null).eq("empresa_id", empresaId)
      )
        .limit(1)
        .maybeSingle();
    };

    // Cambia la fila; si la RLS no deja tocarla, no cambia ninguna y no da
    // error: eso también es «no es administrador».
    const actualizar = async (id: string) => {
      const { data: cambiadas, error } = await tabla(sb, "plantillas_presupuesto")
        .update({ config, logo_url })
        .eq("id", id)
        .select("id");
      if (error) throw errorDeEscritura(error);
      if (!cambiadas?.length) throw new Error(SOLO_ADMIN);
    };

    const actual = await buscar();
    if (actual.error) throw errorDeEscritura(actual.error);
    if (actual.data) {
      await actualizar(actual.data.id as string);
      return { ok: true };
    }

    const { error: errorAlta } = await tabla(sb, "plantillas_presupuesto").insert({
      ambito: ambito.ambito,
      tienda_id: ambito.ambito === "tienda" ? ambito.tiendaId : null,
      empresa_id: empresaId,
      config,
      logo_url,
    });
    if (!errorAlta) return { ok: true };

    // Otro la ha creado entre la búsqueda y el alta (el índice único lo
    // impide dos veces): se cambia la suya.
    if (errorAlta.code === "23505") {
      const otra = await buscar();
      if (otra.error) throw errorDeEscritura(otra.error);
      if (otra.data) {
        await actualizar(otra.data.id as string);
        return { ok: true };
      }
    }
    throw errorDeEscritura(errorAlta);
  });
