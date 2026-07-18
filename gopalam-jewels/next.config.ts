import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

class CopyServerChunksPlugin {
  apply(compiler: any) {
    compiler.hooks.afterEmit.tap("CopyServerChunksPlugin", () => {
      const outputPath = compiler.options.output.path;
      if (!outputPath) return;

      const chunksPath = path.join(outputPath, "chunks");
      if (!fs.existsSync(chunksPath)) return;

      for (const fileName of fs.readdirSync(chunksPath)) {
        if (!fileName.endsWith(".js")) continue;

        fs.copyFileSync(
          path.join(chunksPath, fileName),
          path.join(outputPath, fileName)
        );
      }
    });
  }
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = config.plugins || [];
      config.plugins.push(new CopyServerChunksPlugin());
    }

    return config;
  },
};

export default nextConfig;
