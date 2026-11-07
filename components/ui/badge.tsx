import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  // design.md › Chips & Badges: JetBrains Mono 11px, radio de componente (6px), micro-borde.
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-transparent px-1.5 py-0.5 text-label-sm whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "border-input bg-accent text-foreground [a]:hover:bg-accent/80",
        destructive:
          "border-critical/30 bg-critical-muted text-critical focus-visible:ring-critical/20",
        // Metadata (ERP, contadores): card + borde #27272a + texto secundario.
        outline:
          "border-input bg-card text-muted-foreground [a]:hover:bg-accent [a]:hover:text-foreground",
        // Indicadores semánticos: base apagada + punto de 6px con halo (ver <StatusDot>).
        critical: "border-critical/25 bg-critical-muted text-critical",
        warning: "border-warning/25 bg-warning-muted text-warning",
        success: "border-success/25 bg-success-muted text-success",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

const DOT_TONE = {
  critical: "bg-critical shadow-[0_0_6px_color-mix(in_srgb,var(--critical)_40%,transparent)]",
  warning: "bg-warning shadow-[0_0_6px_color-mix(in_srgb,var(--warning)_40%,transparent)]",
  success: "bg-success shadow-[0_0_6px_color-mix(in_srgb,var(--success)_40%,transparent)]",
  neutral: "bg-subtle-foreground",
} as const

/** Indicador semántico de 6px con halo (design.md › Semantic Indicators). */
function StatusDot({ tone, className }: { tone: keyof typeof DOT_TONE; className?: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone], className)} />
}

export { Badge, badgeVariants, StatusDot }
