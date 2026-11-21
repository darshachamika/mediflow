import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.MEDIFLOW_NEXT_DIST_DIR ?? ".next",
  typescript: { tsconfigPath: process.env.MEDIFLOW_TSCONFIG ?? "tsconfig.json" },
};

export default config;
