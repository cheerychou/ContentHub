// 素材属性摘要（M7 Task 3）：按 content_type 从 meta.attrs 渲染一行轻量摘要，
// 供素材列表「属性」列使用。摘要规则（与任务契约一致）：
//   image → `{width}×{height} · {format}`；video → `{mm:ss} · {format}`；
//   audio → `时长 {mm:ss}`；markdown/docx → `{word_count} 字`；无 → "—"。
// attrs 来自上传自动抽取 / 人工补录（存量数据可能尚未回填），字段可能缺失：
// 逐段可选渲染，全部缺失时兜底 "—"，绝不抛错。

/** 秒 → mm:ss（不足 1 小时）或 h:mm:ss（≥1 小时），如 204s → "03:24"。 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

export function AttrSummary({ contentType, attrs }: {
  contentType: string;
  attrs?: unknown; // meta.attrs（自动抽取/补录写入），可为 undefined
}) {
  const a = (attrs ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (contentType === "image") {
    const w = asNum(a.width);
    const h = asNum(a.height);
    if (w !== null && h !== null) parts.push(`${w}×${h}`);
    const fmt = asStr(a.format);
    if (fmt) parts.push(fmt);
  } else if (contentType === "video") {
    const d = asNum(a.duration_seconds);
    if (d !== null) parts.push(formatDuration(d));
    const fmt = asStr(a.format);
    if (fmt) parts.push(fmt);
  } else if (contentType === "audio") {
    const d = asNum(a.duration_seconds);
    if (d !== null) parts.push(`时长 ${formatDuration(d)}`);
  } else if (contentType === "markdown" || contentType === "docx") {
    const wc = asNum(a.word_count);
    if (wc !== null) parts.push(`${wc} 字`);
  }
  return (
    <span className="text-xs text-muted-foreground">
      {parts.length > 0 ? parts.join(" · ") : "—"}
    </span>
  );
}
