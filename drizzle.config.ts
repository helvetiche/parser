import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH
      ? process.env.DATABASE_PATH.replace(/^file:/, "")
      : process.env.DATABASE_URL?.startsWith("file:")
        ? process.env.DATABASE_URL.replace(/^file:/, "")
        : "./data/app.db",
  },
});
