import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextPlugin = require("@next/eslint-plugin-next");
const reactHooksPlugin = require("eslint-plugin-react-hooks");
const reactPlugin = require("eslint-plugin-react");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

export default [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "dist/**", "build/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooksPlugin,
      react: reactPlugin,
      "@typescript-eslint": tsPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",

      // React Rules
      "react/display-name": "error",
      "react/no-unescaped-entities": "error",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Next.js rules
      "@next/next/no-html-link-for-pages": "error",
      "@next/next/no-img-element": "warn",
    },
  },
  {
    files: ["lib/**/*.ts", "lib/**/*.tsx", "lib/**/*.js", "lib/**/*.jsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
