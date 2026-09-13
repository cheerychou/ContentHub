import type { AssetDetail } from "@/types";

// 主任务选择（纯函数）：返回当前资产最该做的事，null 表示无主任务（只看指引与血缘）
// 主任务在「任务区」默认展开；其余能力一律收进「更多操作」，不删除任何功能。
export function primaryTask(d: AssetDetail): string | null {
  if (d.zone === "master") {
    if (d.content_type === "image") {
      if (d.status === "finalized") return "master_image_finalized";
      if (d.status === "topic" || d.status === "drafting")
        return "master_image_drafting";
      return null; // publishing / published：渲染封面移入更多操作
    }
    if (d.status === "topic" || d.status === "drafting")
      return "master_text_drafting";
    if (d.status === "finalized") return "master_text_finalized";
    return null; // publishing / published：文本变体移入更多操作
  }
  if (d.zone === "publish") {
    if (d.meta?.kind === "video_kit") return d.file_url ? "video_kit" : null;
    // 文本发布物（口播稿）：派生创建即 publishing，出语音包是当前任务，直到已发布
    if (d.content_type === "markdown")
      return d.status === "published" ? null : "publish_markdown";
    if (d.status === "publishing") return "publish_publishing";
    return null; // 已发布/未到发布中的非 markdown：发布登记移入更多操作
  }
  if (d.zone === "topic") {
    // 候选/调研中/已立项/已搁置 → 阶段推进任务（按钮或产出文稿表单，见 renderTask）
    if (["candidate", "researching", "approved", "shelved"].includes(d.status))
      return "topic_stage";
    return null; // available 等：选题区无该状态
  }
  return null; // source：素材（底片）无主任务，看指引与血缘即可
}
