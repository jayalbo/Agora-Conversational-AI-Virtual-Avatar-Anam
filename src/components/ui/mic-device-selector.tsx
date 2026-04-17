"use client";

import { Check, ChevronDown, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type MicDevice = {
  deviceId: string;
  label: string;
};

type MicDeviceSelectorProps = {
  devices: MicDevice[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string | null) => void;
  defaultLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Compact dropdown for picking an input microphone. Opens upward since it's
 * mounted in the bottom control dock. If no devices are available yet
 * (permissions not granted) the trigger is disabled and shows the default
 * label.
 */
export function MicDeviceSelector({
  devices,
  selectedDeviceId,
  onSelect,
  defaultLabel,
  ariaLabel,
  disabled = false,
  className
}: MicDeviceSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) ?? null;
  const displayLabel = selectedDevice?.label ?? defaultLabel;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={displayLabel}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--agora-primary)]/60 disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <Mic className="h-3.5 w-3.5 text-slate-400" />
        <span className="max-w-[140px] truncate text-slate-200">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 min-w-[240px] max-w-[320px] overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-2xl shadow-black/60 backdrop-blur-md"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={selectedDeviceId === null}
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selectedDeviceId === null
                  ? "bg-[color:var(--agora-primary)]/15 text-[color:var(--agora-blue)]"
                  : "text-slate-200 hover:bg-white/5"
              )}
            >
              <Mic className="h-3.5 w-3.5 text-slate-400" />
              <span className="flex-1 truncate">{defaultLabel}</span>
              {selectedDeviceId === null ? (
                <Check className="h-4 w-4 text-[color:var(--agora-blue)]" />
              ) : null}
            </button>
          </li>
          {devices.length > 0 ? (
            <li className="my-1 h-px bg-white/5" aria-hidden="true" />
          ) : null}
          {devices.map((device) => {
            const isSelected = device.deviceId === selectedDeviceId;
            return (
              <li key={device.deviceId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelect(device.deviceId);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-[color:var(--agora-primary)]/15 text-[color:var(--agora-blue)]"
                      : "text-slate-200 hover:bg-white/5"
                  )}
                >
                  <Mic className="h-3.5 w-3.5 text-slate-400" />
                  <span className="flex-1 truncate" title={device.label}>
                    {device.label}
                  </span>
                  {isSelected ? <Check className="h-4 w-4 text-[color:var(--agora-blue)]" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
