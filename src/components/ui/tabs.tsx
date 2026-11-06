"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Tabs with roving focus (arrow keys, Home/End) and tab/tabpanel semantics from Radix. */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: "underline" | "pill" }>(
  ({ className, variant = "underline", ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "flex max-w-full overflow-x-auto [scrollbar-width:none]",
        variant === "underline" ? "gap-1 border-b border-border" : "inline-flex w-fit gap-1 rounded-md bg-surface-sunken p-1",
        className,
      )}
      data-variant={variant}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex min-h-10 shrink-0 items-center gap-1.5 px-3 text-base font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:opacity-50",
      "[[data-variant=underline]_&]:-mb-px [[data-variant=underline]_&]:border-b-2 [[data-variant=underline]_&]:border-transparent [[data-variant=underline]_&]:data-[state=active]:border-primary [[data-variant=underline]_&]:data-[state=active]:text-fg",
      "[[data-variant=pill]_&]:min-h-8 [[data-variant=pill]_&]:rounded-sm [[data-variant=pill]_&]:data-[state=active]:bg-surface [[data-variant=pill]_&]:data-[state=active]:text-fg [[data-variant=pill]_&]:data-[state=active]:shadow-xs",
      "[&_svg]:size-4",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("pt-4 outline-none focus-visible:outline-2 focus-visible:outline-focus", className)} {...props} />
));
TabsContent.displayName = "TabsContent";
