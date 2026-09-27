import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Files that are not part of the Next.js application. Linting these was
    // the whole of the `lint-frontend` CI failure: `"lint": "eslint"` passes
    // no path, so ESLint 9 walked the entire repository and reported CommonJS
    // `require` in the Hardhat tooling and `any` in the migration script.
    //
    // Each entry below is a different tool with its own conventions, not a
    // place where `no-explicit-any` or `no-require-imports` means anything.
    "hardhat.config.js",      // Hardhat 2, CommonJS by requirement
    "scripts/deploy.js",      // Hardhat script, CommonJS by requirement
    "test/*.test.js",         // Hardhat test — CommonJS, and excluded from
                              // vitest.config.ts, so `npm test` never sees it
    "scripts/**/*.ts",        // tsx scripts: run directly, never bundled
    "contracts/**",           // Solidity, plus Hardhat's generated artifacts
    "ai-service/**",          // Python — a separate lint job (ruff) covers it
    "*.js",                   // root-level config, e.g. postcss/tailwind
  ]),
]);

export default eslintConfig;
