import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Agora "a" mark — a filled version of the glyph from the official logo.
 * Use this in tight round avatars/dots where the full wordmark would be
 * too wide. For full branding use <AgoraLogo /> (the PNG wordmark).
 */
export function AgoraMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
      {...props}
    >
      <path
        d="M8.715 13.81a4.81 4.81 0 1 1 0-9.62 4.81 4.81 0 0 1 0 9.62Zm5.602-11.818-.074.098-.073.097-.097-.073-.093-.073a8.722 8.722 0 1 0-5.265 15.68 8.63 8.63 0 0 0 5.265-1.772l.093-.068.097-.078.073.102.074.098a4.16 4.16 0 0 0 2.798 1.68l.322.044V.273l-.322.044a4.165 4.165 0 0 0-2.798 1.675Z"
        fill="currentColor"
      />
    </svg>
  );
}
