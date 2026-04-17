import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--agora-primary)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--agora-dark-900)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--agora-primary)] text-white shadow-lg shadow-[color:var(--agora-primary)]/30 hover:bg-[color:var(--agora-blue)] hover:text-[color:var(--agora-dark-900)]",
        secondary:
          "bg-white/5 text-slate-100 border border-white/10 hover:bg-white/10",
        destructive:
          "bg-[color:var(--agora-accent-negative)] text-white shadow-lg shadow-[color:var(--agora-accent-negative)]/30 hover:brightness-110",
        outline:
          "border border-white/10 bg-transparent text-slate-100 hover:bg-white/5",
        ghost: "text-slate-300 hover:bg-white/5 hover:text-slate-50"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3",
        lg: "h-11 rounded-xl px-8",
        icon: "h-10 w-10",
        "icon-lg": "h-12 w-12 rounded-full"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
