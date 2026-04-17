import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**"]
  },
  {
    rules: {
      // The Agora SDKs (RTC, RTM, voice-AI toolkit) are dynamically imported
      // and we store them as `any` refs. Relaxing to a warning keeps Vercel's
      // production build from failing on those intentional casts.
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];

export default eslintConfig;
