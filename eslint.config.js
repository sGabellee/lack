const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
        LackTemplates: "readonly",
        pdfjsLib: "readonly",
        cm: "writable"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-empty": ["error", { "allowEmptyCatch": true }],
      "no-useless-escape": "warn"
    }
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "renderer.bundle.js",
      "renderer.bundle.js.map",
      "spell.worker.bundle.js",
      "spell.worker.bundle.js.map",
      "api/**"
    ]
  }
];
