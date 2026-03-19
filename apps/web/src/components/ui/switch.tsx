import { cn } from "@/lib/utils";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

/**
 * Switch component with macOS-style visuals
 *
 * Design spec: design-system PR #85
 * - Three sizes: default, sm, xs
 * - ON state: #007AFF blue background with white vertical bar indicator
 * - OFF state: #e5e5e5 gray background with hollow circle indicator
 * - Capsule-shaped thumb
 * - Optional loading state for async operations
 */

const SIZES = {
  default: {
    track: "h-[24px] w-[50px] rounded-[12px] p-[2px]",
    thumb: "h-[20px] w-[32px] rounded-[10px]",
    translate: "data-[state=checked]:translate-x-[14px]",
    onBar: "left-[8px] w-[2px] h-[9px]",
    offDot: "right-[6px] w-[6px] h-[6px] border-[1.5px]",
  },
  sm: {
    track: "h-[18px] w-[38px] rounded-[9px] p-[2px]",
    thumb: "h-[14px] w-[24px] rounded-[7px]",
    translate: "data-[state=checked]:translate-x-[10px]",
    onBar: "left-[5px] w-[1.5px] h-[7px]",
    offDot: "right-[4px] w-[5px] h-[5px] border-[1.5px]",
  },
  xs: {
    track: "h-[14px] w-[28px] rounded-[7px] p-[1.5px]",
    thumb: "h-[11px] w-[17px] rounded-[5.5px]",
    translate: "data-[state=checked]:translate-x-[8px]",
    onBar: "left-[4px] w-[1px] h-[5px]",
    offDot: "right-[3px] w-[4px] h-[4px] border-[1px]",
  },
} as const;

const switchVariants = cva(
  "peer inline-flex shrink-0 cursor-pointer items-center overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: SIZES.default.track,
        sm: SIZES.sm.track,
        xs: SIZES.xs.track,
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export interface SwitchProps
  extends Omit<
      ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
      "asChild"
    >,
    VariantProps<typeof switchVariants> {
  /** Show loading spinner in thumb */
  loading?: boolean;
}

const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, size = "default", loading, disabled, ...props }, ref) => {
  const sizeConfig = SIZES[size ?? "default"];

  return (
    <SwitchPrimitives.Root
      className={cn(
        switchVariants({ size }),
        // Track colors
        "bg-[#e5e5e5] data-[state=checked]:bg-[#007AFF]",
        // Transition
        "transition-colors duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        className,
      )}
      disabled={disabled || loading}
      ref={ref}
      {...props}
    >
      {/* ON indicator: white vertical bar (left side, visible when checked) */}
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-[1px] bg-white/90 transition-opacity duration-200",
          sizeConfig.onBar,
          "opacity-0 data-[state=checked]:opacity-100",
        )}
        data-state={props.checked ? "checked" : "unchecked"}
      />

      {/* OFF indicator: hollow gray circle (right side, visible when unchecked) */}
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full border-[#b0b0b0] bg-transparent transition-opacity duration-200",
          sizeConfig.offDot,
          "opacity-100 data-[state=checked]:opacity-0",
        )}
        data-state={props.checked ? "checked" : "unchecked"}
      />

      {/* Thumb */}
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none relative block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]",
          sizeConfig.thumb,
          sizeConfig.translate,
          "transition-transform duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          "data-[state=unchecked]:translate-x-0",
        )}
      >
        {/* Loading spinner inside thumb */}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                "animate-spin rounded-full border-2 border-current border-t-transparent text-[#007AFF]/60",
                size === "xs"
                  ? "h-2 w-2"
                  : size === "sm"
                    ? "h-2.5 w-2.5"
                    : "h-3 w-3",
              )}
            />
          </span>
        )}
      </SwitchPrimitives.Thumb>
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = "Switch";

export { Switch };
