// Estilo común de las gráficas (recharts), con los colores de la paleta para que
// rejilla, ejes y bocadillo se lean igual en claro y en oscuro. Fichero sin
// recharts: se importa de forma normal desde las gráficas perezosas y desde
// Gerencia sin arrastrar la librería.

/** La rejilla: solo líneas horizontales, del color de los bordes. */
export const REJILLA = {
  strokeDasharray: "3 3",
  vertical: false,
  stroke: "var(--color-border)",
} as const;

/** La línea de los ejes. */
export const EJE = { stroke: "var(--color-border)" } as const;

/** El texto de los ejes. */
export const TEXTO_EJE = { fill: "var(--color-muted-foreground)", fontSize: 11 } as const;

/** El bocadillo al pasar por encima, y la franja que marca la barra. */
export const BOCADILLO = {
  contentStyle: {
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    color: "var(--color-card-foreground)",
  },
  labelStyle: { color: "var(--color-card-foreground)" },
  itemStyle: { color: "var(--color-card-foreground)" },
  cursor: { fill: "var(--color-muted)", opacity: 0.6 },
} as const;
