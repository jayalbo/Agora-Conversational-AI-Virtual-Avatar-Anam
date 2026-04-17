import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-white/5 text-slate-300 border border-white/10",
        success:
          "bg-[color:var(--agora-primary)]/10 text-[color:var(--agora-blue)] border border-[color:var(--agora-primary)]/30",
        warn:
          "bg-[color:var(--agora-accent-warning)]/10 text-[color:var(--agora-accent-warning)] border border-[color:var(--agora-accent-warning)]/25",
        danger:
          "bg-[color:var(--agora-accent-negative)]/10 text-[color:var(--agora-accent-negative)] border border-[color:var(--agora-accent-negative)]/25"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
