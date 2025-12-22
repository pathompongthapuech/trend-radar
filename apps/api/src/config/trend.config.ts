export default () => ({
  trend: {
    normalize: {
      mode: "soft",            // fixed now
      ensureHashPrefix: true,
      trim: true,
      collapseSpaces: true,
      unicodeForm: "NFKC",     // safest baseline
      caseFold: false          // อย่า lower/upper ภาษาไทย/แฮชแท็กมั่ว
    },
    alias: {
      enabled: true,
      source: "db",            // "db" | "json"
      jsonPath: "config/aliases.json"
    }
  }
});