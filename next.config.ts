import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js resolves its worker via dynamic import at runtime, which breaks
  // when bundled — keep it external to the server bundle.
  // better-sqlite3 is native and must also stay external.
  serverExternalPackages: ["pdfjs-dist", "better-sqlite3"],
};

export default nextConfig;
