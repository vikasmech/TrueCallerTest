import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Keep the existing React 18 data-fetching effects during this framework migration.
    // Report the new compiler-style rule as a warning on these legacy pages, not silently off.
    files: [
      "src/app/admin/imports/page.tsx",
      "src/app/admin/sources/page.tsx",
      "src/app/auth/verify/page.tsx",
      "src/app/dispute/page.tsx",
      "src/app/moderation/page.tsx",
      "src/app/my-reports/page.tsx",
      "src/lib/auth.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);
