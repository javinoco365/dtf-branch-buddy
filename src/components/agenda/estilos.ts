// Clases e iconos de la Agenda (sin componentes: así piezas.tsx solo exporta
// componentes y la recarga en caliente funciona).
import { Briefcase, Eye, type LucideIcon, Package, Tag, User, Wrench } from "lucide-react";
import { PRIORIDADES, type CategoriaAgenda, type Prioridad } from "@/dominio/agenda";

/**
 * Las clases de cada prioridad, escritas enteras para que Tailwind las vea.
 *   punto: el cuadradito de color; borde: la raya de la izquierda;
 *   suave: el fondo claro; texto: el color sobre ese fondo.
 */
export const CLASES_PRIORIDAD: Record<
  Prioridad,
  {
    punto: string;
    borde: string;
    suave: string;
    texto: string;
    anillo: string;
    /** En el móvil, la pastilla del mes es solo una barra de su color. */
    barra: string;
  }
> = {
  urgente: {
    punto: "bg-prioridad-urgente",
    borde: "border-l-prioridad-urgente",
    suave: "bg-prioridad-urgente/10",
    texto: "text-prioridad-urgente-texto",
    anillo: "border-prioridad-urgente ring-prioridad-urgente",
    barra: "max-sm:bg-prioridad-urgente",
  },
  alta: {
    punto: "bg-prioridad-alta",
    borde: "border-l-prioridad-alta",
    suave: "bg-prioridad-alta/12",
    texto: "text-prioridad-alta-texto",
    anillo: "border-prioridad-alta ring-prioridad-alta",
    barra: "max-sm:bg-prioridad-alta",
  },
  normal: {
    punto: "bg-prioridad-normal",
    borde: "border-l-prioridad-normal",
    suave: "bg-prioridad-normal/10",
    texto: "text-prioridad-normal-texto",
    anillo: "border-prioridad-normal ring-prioridad-normal",
    barra: "max-sm:bg-prioridad-normal",
  },
  baja: {
    punto: "bg-prioridad-baja",
    borde: "border-l-prioridad-baja",
    suave: "bg-prioridad-baja/12",
    texto: "text-prioridad-baja-texto",
    anillo: "border-prioridad-baja ring-prioridad-baja",
    barra: "max-sm:bg-prioridad-baja",
  },
};

/**
 * «Realizada»: el verde de éxito para puntos, rayas y fondos; el texto, en su
 * variante -texto, que pasa AA sobre el fondo suave en claro y en oscuro.
 * `circulo`: el botón redondo marcado; el ✓ va en blanco en claro y en tinta
 * oscura en oscuro (el blanco sobre el verde claro del modo oscuro no se lee).
 */
export const CLASES_REALIZADA = {
  punto: "bg-status-completado",
  borde: "border-l-status-completado",
  suave: "bg-status-completado/10",
  texto: "text-realizada-texto",
  barra: "max-sm:bg-status-completado",
  circulo: "border-status-completado bg-status-completado text-white dark:text-background",
  /** El círculo sin marcar, al pasar por encima. */
  circuloVacio:
    "border-input text-transparent hover:border-status-completado hover:text-realizada-texto",
};

export function prioridadDe(id: Prioridad) {
  return PRIORIDADES.find((p) => p.id === id) ?? PRIORIDADES[2]!;
}

const ICONOS: Record<string, LucideIcon> = {
  package: Package,
  user: User,
  briefcase: Briefcase,
  wrench: Wrench,
  eye: Eye,
  tag: Tag,
};

export function iconoDeCategoria(c: Pick<CategoriaAgenda, "icono" | "enlace"> | null | undefined) {
  if (!c) return Tag;
  return (
    (c.icono && ICONOS[c.icono]) ||
    (c.enlace === "pedido" ? Package : c.enlace === "cliente" ? User : Tag)
  );
}
