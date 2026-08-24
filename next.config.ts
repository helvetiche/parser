import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js resolves its worker via dynamic import at runtime, which breaks
  // when bundled — keep it external to the server bundle.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
