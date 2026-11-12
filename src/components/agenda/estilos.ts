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
  { punto: string; borde: string; suave: string; texto: string; anillo: string }
> = {
  urgente: {
    punto: "bg-prioridad-urgente",
    borde: "border-l-prioridad-urgente",
    suave: "bg-prioridad-urgente/10",
    texto: "text-prioridad-urgente",
    anillo: "border-prioridad-urgente ring-prioridad-urgente",
  },
  alta: {
    punto: "bg-prioridad-alta",
    borde: "border-l-prioridad-alta",
    suave: "bg-prioridad-alta/12",
    texto: "text-prioridad-alta",
    anillo: "border-prioridad-alta ring-prioridad-alta",
  },
  normal: {
    punto: "bg-prioridad-normal",
    borde: "border-l-prioridad-normal",
    suave: "bg-prioridad-normal/10",
    texto: "text-prioridad-normal",
    anillo: "border-prioridad-normal ring-prioridad-normal",
  },
  baja: {
    punto: "bg-prioridad-baja",
    borde: "border-l-prioridad-baja",
    suave: "bg-prioridad-baja/12",
    texto: "text-muted-foreground",
    anillo: "border-prioridad-baja ring-prioridad-baja",
  },
};

export const CLASES_REALIZADA = {
  punto: "bg-status-completado",
  borde: "border-l-status-completado",
  suave: "bg-status-completado/10",
  texto: "text-status-completado",
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
