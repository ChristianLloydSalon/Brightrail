import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "test-results/**", "playwright-report/**", "scripts/**", "next-env.d.ts", "_to_delete/**"] },
  {
    rules: {
      // Product copy uses natural apostrophes; React escapes them safely.
      "react/no-unescaped-entities": "off",
      // Form-reset-on-open effects are intentional; tracked as warnings (see IMPLEMENTATION_AUDIT.md).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
export default config;
