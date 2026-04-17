"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { LOCALES, useI18n, type Locale } from "@/lib/i18n";

type LanguageSelectorProps = {
  variant?: "compact" | "full";
  align?: "start" | "end";
  className?: string;
};

export function LanguageSelector({
  variant = "compact",
  align = "end",
  className
}: LanguageSelectorProps) {
  const { locale, setLocale, localeMeta } = useI18n();
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

  const handleSelect = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--agora-primary)]/60",
          variant === "full" && "w-full justify-between px-3 py-2 text-sm"
        )}
      >
        <span className="flex items-center gap-2">
          {variant === "full" ? (
            <Globe className="h-3.5 w-3.5 text-slate-400" />
          ) : null}
          <span className="text-base leading-none">{localeMeta.flag}</span>
          <span className="text-slate-200">
            {variant === "full" ? localeMeta.label : localeMeta.shortLabel}
          </span>
        </span>
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
          className={cn(
            "absolute top-full z-30 mt-2 min-w-[200px] overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-2xl shadow-black/60 backdrop-blur-md",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {LOCALES.map((option) => {
            const isSelected = option.code === locale;
            return (
              <li key={option.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.code)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-[color:var(--agora-primary)]/15 text-[color:var(--agora-blue)]"
                      : "text-slate-200 hover:bg-white/5"
                  )}
                >
                  <span className="text-lg leading-none">{option.flag}</span>
                  <span className="flex-1 truncate">{option.label}</span>
                  {isSelected ? (
                    <Check className="h-4 w-4 text-[color:var(--agora-blue)]" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
