import Image, { type ImageProps } from "next/image";

import { cn } from "@/lib/utils";

// Official Agora wordmark (downloaded from agora.io). It's the full
// "a + agora" logo lockup, so aspect ratio is ~2.13:1. We serve it from
// /public so Next/Image can optimize it.
const LOGO_SRC = "/agora-logo.png";
const LOGO_WIDTH = 500;
const LOGO_HEIGHT = 235;

export type AgoraLogoProps = Omit<
  ImageProps,
  "src" | "width" | "height" | "alt"
> & {
  alt?: string;
};

/**
 * Renders the official Agora wordmark. The image keeps its native aspect
 * ratio; callers should control the size via `className` (e.g. `h-6 w-auto`).
 */
export function AgoraLogo({ className, alt = "Agora", ...props }: AgoraLogoProps) {
  return (
    <Image
      src={LOGO_SRC}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      alt={alt}
      priority
      className={cn("h-6 w-auto object-contain", className)}
      {...props}
    />
  );
}
