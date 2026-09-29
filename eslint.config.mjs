import nextConfig from "eslint-config-next";

// `eslint-config-next` exports an array of flat configs, so it is spread rather
// than called. Kept as the project's only lint preset so the CI gate lints with
// exactly the rules a `next lint` user would see.
const config = [
  ...nextConfig,
  {
    // `public/**` is served verbatim to the browser and includes the service
    // worker, which is a plain worker script with worker globals (`self`,
    // `caches`, `fetch`) rather than application code — it is exercised by
    // `tests/unit/pwa.test.ts`, not by the app lint preset.
    ignores: [".next/**", ".cache/**", "node_modules/**", "vendor/**", "public/**"],
  },
  {
    // The tooling scripts under scripts/ are plain Node ESM rather than Next.js
    // code, so the handful of Node globals they use are declared here instead of
    // pulling in a globals package just for this.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
];

export default config;
