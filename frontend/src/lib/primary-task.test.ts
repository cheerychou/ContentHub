import { describe, expect, it } from "vitest";
import { primaryTask } from "@/lib/primary-task";
import type { AssetDetail } from "@/types";

// 测试夹具：primaryTask 只依赖 zone/status/content_type/meta.kind/file_url，
// 其余必填字段用占位值填满以满足 AssetDetail 类型。
function mkDetail(p: Partial<AssetDetail>): AssetDetail {
  return {
    id: "a1",
    zone: "source",
    status: "available",
    title: "t",
    file_name: null,
    content_type: "markdown",
    source_url: null,
    created_by: "u",
    meta: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    upstream: [],
    downstream: [],
    file_url: null,
    text_content: null,
    published_url: null,
    published_at: null,
    ...p,
  };
}

describe("primaryTask", () => {
  describe("master 区", () => {
    it("文本 drafting → 定稿任务", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", status: "drafting" })),
      ).toBe("master_text_drafting");
    });

    it("文本 topic（同 drafting 档）→ 定稿任务", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", status: "topic", content_type: "docx" })),
      ).toBe("master_text_drafting");
    });

    it("文本 finalized → 文本变体任务", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", status: "finalized" })),
      ).toBe("master_text_finalized");
    });

    it("文本 publishing → null（文本变体移入更多操作）", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", status: "publishing" })),
      ).toBeNull();
    });

    it("图片 drafting → 渲染封面（底图创作中）", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", content_type: "image", status: "drafting" })),
      ).toBe("master_image_drafting");
    });

    it("图片 topic（同 drafting 档）→ 渲染封面", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", content_type: "image", status: "topic" })),
      ).toBe("master_image_drafting");
    });

    it("图片 finalized → 渲染封面", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", content_type: "image", status: "finalized" })),
      ).toBe("master_image_finalized");
    });

    it("图片 publishing → null（渲染封面移入更多操作）", () => {
      expect(
        primaryTask(mkDetail({ zone: "master", content_type: "image", status: "publishing" })),
      ).toBeNull();
    });
  });

  describe("publish 区", () => {
    it("markdown 发布物 publishing → 语音包任务", () => {
      expect(
        primaryTask(mkDetail({ zone: "publish", status: "publishing" })),
      ).toBe("publish_markdown");
    });

    it("markdown 已发布 → null", () => {
      expect(
        primaryTask(mkDetail({ zone: "publish", status: "published" })),
      ).toBeNull();
    });

    it("markdown 非 published 态（类型联合合法者 finalized）→ 仍给语音包任务", () => {
      expect(
        primaryTask(mkDetail({ zone: "publish", status: "finalized" })),
      ).toBe("publish_markdown");
    });

    it("video_kit 且有文件 → 语音包装配任务", () => {
      expect(
        primaryTask(mkDetail({
          zone: "publish",
          status: "publishing",
          content_type: "image",
          meta: { kind: "video_kit" },
          file_url: "https://example.com/kit.zip",
        })),
      ).toBe("video_kit");
    });

    it("video_kit 无文件 → null", () => {
      expect(
        primaryTask(mkDetail({
          zone: "publish",
          status: "publishing",
          content_type: "image",
          meta: { kind: "video_kit" },
        })),
      ).toBeNull();
    });

    it("非 markdown publishing → 发布登记", () => {
      expect(
        primaryTask(mkDetail({ zone: "publish", content_type: "image", status: "publishing" })),
      ).toBe("publish_publishing");
    });

    it("非 markdown 已发布 → null", () => {
      expect(
        primaryTask(mkDetail({ zone: "publish", content_type: "image", status: "published" })),
      ).toBeNull();
    });
  });

  describe("topic 区", () => {
    it.each(["candidate", "researching", "approved", "shelved"] as const)(
      "状态 %s → topic_stage",
      (status) => {
        expect(primaryTask(mkDetail({ zone: "topic", status }))).toBe("topic_stage");
      },
    );

    it("available → null（选题区无该状态）", () => {
      expect(primaryTask(mkDetail({ zone: "topic", status: "available" }))).toBeNull();
    });
  });

  describe("source 区", () => {
    it("素材 → null（无主任务，看指引与血缘）", () => {
      expect(primaryTask(mkDetail({ zone: "source", status: "available" }))).toBeNull();
    });
  });
});
