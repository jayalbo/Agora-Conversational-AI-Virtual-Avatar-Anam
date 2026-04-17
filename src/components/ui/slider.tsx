"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type SliderProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
};

/**
 * Minimal range slider styled to match the dark shadcn look used across
 * the app. Built on a native <input type="range"> so it is accessible and
 * needs no extra dependency.
 */
export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, min, max, step = 0.01, onValueChange, ...props }, ref) => {
    const range = max - min;
    const percent = range > 0 ? ((value - min) / range) * 100 : 0;

    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full border border-white/10 bg-white/5 outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--agora-primary)]/60",
          // Webkit thumb
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/20 [&::-webkit-slider-thumb]:bg-[color:var(--agora-blue)] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-[color:var(--agora-primary)]/60 [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110",
          // Firefox thumb
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/20 [&::-moz-range-thumb]:bg-[color:var(--agora-blue)] [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:shadow-[color:var(--agora-primary)]/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{
          background: `linear-gradient(to right, rgba(9, 157, 253, 0.75) 0%, rgba(0, 194, 255, 0.75) ${percent}%, rgba(255, 255, 255, 0.05) ${percent}%, rgba(255, 255, 255, 0.05) 100%)`
        }}
        {...props}
      />
    );
  }
);

Slider.displayName = "Slider";
