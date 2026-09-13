import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttrSummary } from "@/components/common/attr-summary";

// 断言依据组件实际实现（attr-summary.tsx）：
// image → `{w}×{h} · {format}`；video → `{mm:ss} · {format}`；
// attrs 缺省 / 段落全缺 / 非属性五类类型 → 兜底 "—"。
describe("AttrSummary", () => {
  it("image：有 attrs → 渲染尺寸与格式摘要", () => {
    render(
      <AttrSummary
        contentType="image"
        attrs={{ width: 1920, height: 1080, format: "png" }}
      />,
    );
    expect(screen.getByText("1920×1080 · png")).toBeInTheDocument();
  });

  it("video：有 attrs → 渲染时长（mm:ss）与格式摘要", () => {
    render(
      <AttrSummary
        contentType="video"
        attrs={{ duration_seconds: 204, format: "mp4" }}
      />,
    );
    expect(screen.getByText("03:24 · mp4")).toBeInTheDocument();
  });

  it("attrs 缺省（undefined）→ 渲染 —", () => {
    render(<AttrSummary contentType="image" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("属性五类之外（link）即使带 attrs → 渲染 —", () => {
    render(<AttrSummary contentType="link" attrs={{ width: 100 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
