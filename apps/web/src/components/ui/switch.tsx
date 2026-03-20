import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef } from "react";

/**
 * macOS 26 (Tahoe) style Toggle Switch
 *
 * Visual spec from design-system:
 * - ON bg: #007AFF (macOS system blue)
 * - OFF bg: #e5e5e5 (neutral grey)
 * - Thumb: white capsule with subtle shadow
 * - State indicators: ON has white bar, OFF has grey circle
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
};

export interface SwitchProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
    "children"
  > {
  size?: "default" | "sm" | "xs";
  loading?: boolean;
}

export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(
  (
    { size = "default", loading = false, disabled, className, ...props },
    ref,
  ) => {
    const s = SIZES[size];
    const isDisabled = disabled || loading;

    return (
      <SwitchPrimitive.Root
        ref={ref}
        disabled={isDisabled}
        className={`
        relative inline-flex shrink-0 cursor-pointer items-center overflow-hidden
        transition-colors duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50
        data-[state=checked]:bg-[var(--color-toggle-on)]
        data-[state=unchecked]:bg-[#e5e5e5]
        ${s.track}
        ${className ?? ""}
      `}
        {...props}
      >
        {/* ON indicator — white vertical bar */}
        <span
          className={`
          absolute top-1/2 -translate-y-1/2 bg-white/90 rounded-[1px]
          transition-opacity duration-200
          data-[state=checked]:opacity-100 data-[state=unchecked]:opacity-0
          ${s.onBar}
        `}
          data-state={props.checked ? "checked" : "unchecked"}
        />

        {/* OFF indicator — grey hollow circle */}
        <span
          className={`
          absolute top-1/2 -translate-y-1/2 rounded-full border-[#b0b0b0]
          transition-opacity duration-200
          data-[state=checked]:opacity-0 data-[state=unchecked]:opacity-100
          ${s.offDot}
        `}
          data-state={props.checked ? "checked" : "unchecked"}
        />

        {/* Thumb */}
        <SwitchPrimitive.Thumb
          className={`
          pointer-events-none block bg-white
          shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]
          transition-transform duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${s.thumb}
          ${s.translate}
          ${loading ? "animate-pulse" : ""}
        `}
        />
      </SwitchPrimitive.Root>
    );
  },
);

Switch.displayName = "Switch";
