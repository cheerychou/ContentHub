// Vitest 全局 setup（Task 2）：
// 1. 引入 @testing-library/jest-dom 的 vitest 入口，为 expect 扩展
//    toBeInTheDocument 等 DOM 断言匹配器。项目未启用 vitest globals
//    （测试显式 import），故用 "/vitest" 子路径入口——它直接扩展 vitest 的
//    expect，不依赖全局 expect。
// 2. 未启用 globals 时 RTL 的自动 cleanup 不生效（依赖全局 afterEach），
//    显式注册，避免用例间 DOM 残留导致 screen 查询命中多元素。
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
