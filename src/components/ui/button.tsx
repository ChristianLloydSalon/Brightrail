import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg shadow-xs hover:bg-primary-hover",
        secondary: "bg-secondary-soft text-secondary-soft-fg hover:bg-[color-mix(in_oklab,var(--secondary-soft),var(--secondary)_10%)]",
        outline: "border border-border-strong bg-surface text-fg shadow-xs hover:bg-surface-hover",
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
        destructive: "bg-danger text-white shadow-xs hover:bg-danger-hover dark:text-fg-inverse",
        "destructive-outline": "border border-danger-border bg-surface text-danger-fg hover:bg-danger-soft",
        link: "h-auto px-0 text-link underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-3.5 text-base",
        lg: "h-11 px-5 text-md",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, loadingText, disabled, children, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        type={asChild ? undefined : (type ?? "button")}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {loading && loadingText ? loadingText : children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
