// Vitest 配置（Task 2）：与 vite.config.ts 合并，复用 react 插件与 @ 别名，仅追加 test 段。
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  }),
);
