import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  clearPublishInfo, deleteAsset, derive, deriveText, deriveVideoKit, getAsset,
  fetchPlatformMeta, linkDerivation, listAssets, listRecipes, patchStatus,
  publishInfo, renderCover, uploadAsset, type PlatformMeta,
} from "./api";
import {
  RECIPE_KIND_LABELS, STATUS_LABELS, TRANSITIONS,
  ZONE_LABELS, type Asset, type AssetDetail, type Recipe, type Zone,
} from "./types";
import Recipes from "./Recipes";

const ZONES: Zone[] = ["source", "master", "publish"];

// 状态驱动的「下一步」指引（流程导向，降低学习成本）
function nextStepHint(d: AssetDetail): string {
  if (d.zone === "source") {
    return "这是源料（底片），仅供引用与检索。要加工内容，请回顶部另传母版。";
  }
  if (d.zone === "master") {
    if (d.content_type === "image") {
      if (d.status === "topic" || d.status === "drafting")
        return "这是封面底图。写好后点下方「定稿」，再用「渲染封面」按平台出图。";
      if (d.status === "finalized")
        return "✓ 底图已定稿 → 用下方「渲染封面」选平台（如 抖音·竖版）出图。";
      return "底图已进入发布流程。";
    }
    if (d.status === "topic" || d.status === "drafting")
      return "还在创作中。写完后点下方「定稿」，解锁封面与变体能力。";
    if (d.status === "finalized")
      return "✓ 已定稿，两件事可做：① 下方「文本变体」生成口播稿/公众号版/GEO 变体；② 另传一张图片母版来渲染本篇封面。";
    if (d.status === "publishing")
      return "发布物装配中。各平台发布完成后点「已发布」收口。";
    return "母版已收口 ✓。派生内容在下方血缘中统一管理。";
  }
  // publish 区
  if (d.meta?.kind === "video_kit")
    return "语音包就绪 → 点「文件」下载 zip，解压后把 subtitle.srt 导入剪映、按 shotlist.md 装配画面。";
  if (d.content_type === "markdown")
    return "这是文本发布物（如口播稿）→ 用下方「生成视频语音包」出三件套；正式发布后填链接完成登记。";
  if (d.status === "publishing")
    return "发布完成了吗？→ 下方填入平台链接完成登记（登记后状态可点「已发布」收口）。";
  return "已登记发布 ✓。全流程完成。";
}

// 任务区主按钮 / 主 CTA（定稿、下载语音包）
const PRIMARY_BTN: CSSProperties = {
  background: "#1d6fd2", color: "#fff", border: "none", borderRadius: 6,
  padding: "10px 24px", fontSize: 16, cursor: "pointer",
};
const PRIMARY_LINK: CSSProperties = {
  display: "inline-block", background: "#1d6fd2", color: "#fff",
  borderRadius: 6, padding: "10px 24px", fontSize: 16,
  textDecoration: "none", cursor: "pointer",
};

// 主任务选择（纯函数）：返回当前资产最该做的事，null 表示无主任务（只看指引与血缘）
// 主任务在「任务区」默认展开；其余能力一律收进「更多操作」，不删除任何功能。
function primaryTask(d: AssetDetail): string | null {
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
  return null; // source
}

// 状态快捷筛选 chips：全部 + 五个状态（label 复用 STATUS_LABELS，与表格状态列一致）
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

function useHashRoute(): string {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const f = () => setRoute(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return route;
}

function Nav() {
  const link = (href: string, label: string) => (
    <a href={href} style={{ marginRight: 12 }}>{label}</a>
  );
  return (
    <nav style={{ marginBottom: 8 }}>
      {link("#/", "资产底座")}
      {link("#/recipes", "配方管理")}
    </nav>
  );
}

export default function App() {
  const route = useHashRoute();
  return (
    <>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 0" }}>
        <Nav />
      </div>
      {route.startsWith("#/recipes") ? <Recipes /> : <Assets />}
    </>
  );
}

function Assets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [zone, setZone] = useState<string>("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const detailRef = useRef<HTMLElement | null>(null);

  // 详情面板在长列表下方：打开/更新时自动滚入视野
  useEffect(() => {
    if (detail) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail]);

  // 上传表单
  const [upZone, setUpZone] = useState<string>("master");
  const [upTitle, setUpTitle] = useState("");
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upResult, setUpResult] = useState("");
  // 派生表单
  const [dvTitle, setDvTitle] = useState("");
  const [dvPlatform, setDvPlatform] = useState("微信公众号");
  const [dvFile, setDvFile] = useState<File | null>(null);
  // 补链表单
  const [linkSource, setLinkSource] = useState("");
  // 渲染封面表单
  const [rcPlatform, setRcPlatform] = useState("微信公众号");
  const [rcRecipeId, setRcRecipeId] = useState("");
  const [rcTitle, setRcTitle] = useState("");
  const [rcSubtitle, setRcSubtitle] = useState("");
  const [rcSpec, setRcSpec] = useState("");
  // 文本变体表单
  const [dtRecipeId, setDtRecipeId] = useState("");
  const [dtTitle, setDtTitle] = useState("");
  const [dtInstructions, setDtInstructions] = useState("");
  // 配方缓存
  const [coverRecipes, setCoverRecipes] = useState<Recipe[]>([]);
  const [textRecipes, setTextRecipes] = useState<Recipe[]>([]);
  // 发布登记
  const [pubUrl, setPubUrl] = useState("");
  // 平台常量（启动时拉取一次；失败保持 null：隐藏平台下拉并提示不可用）
  const [platformMeta, setPlatformMeta] = useState<PlatformMeta | null>(null);
  // 视频语音包表单
  const [vkVoice, setVkVoice] = useState("晓晓（女）");
  const [vkTitle, setVkTitle] = useState("");

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets({ zone, status, q }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [zone, status, q]);

  // 统一捕获变更类操作的异常，避免 unhandled rejection 静默失败
  const run = useCallback(async (fn: () => Promise<void>) => {
    try { setError(""); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    void listRecipes("cover_template").then(setCoverRecipes).catch(() => setCoverRecipes([]));
    void listRecipes("text_prompt").then(setTextRecipes).catch(() => setTextRecipes([]));
  }, []);
  useEffect(() => {
    void fetchPlatformMeta().then(setPlatformMeta).catch(() => setPlatformMeta(null));
  }, []);
  useEffect(() => {
    if (!detail) return;
    void getAsset(detail.id).then((d) => { setDetail(d); setPubUrl(d.published_url ?? ""); })
      .catch(() => setDetail(null));
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  const coverPlatforms = platformMeta?.cover ?? [];
  const entryUrls = platformMeta?.entry_urls ?? {};
  const voiceNames = Object.keys(platformMeta?.voices ?? {});
  const voiceOptions = voiceNames.length > 0 ? voiceNames : [vkVoice];

  const task = detail ? primaryTask(detail) : null;

  // —— 表单渲染助手：同一表单可能出现在任务区或更多操作，抽成函数避免重复 JSX ——
  // 全部沿用原有提交逻辑与 run 错误处理，仅移动 DOM 位置。
  const renderDeriveForm = (d: AssetDetail) => (
    <div>
      <h3>派生发布物</h3>
      <p style={{ color: "#888", margin: "4px 0" }}>
        用于登记<strong>已做好的成品文件</strong>（如剪映导出的成片、别处做好的版本）。
        要自动生成封面 → 请先上传图片母版，用它的「渲染封面」。
      </p>
      <select value={dvPlatform} onChange={(e) => setDvPlatform(e.target.value)}>
        {["微信公众号", "抖音", "微信视频号", "哔哩哔哩", "官网"].map((p) =>
          <option key={p}>{p}</option>)}
      </select>
      <input placeholder="发布物标题" value={dvTitle}
             onChange={(e) => setDvTitle(e.target.value)} />
      <input type="file" onChange={(e) => setDvFile(e.target.files?.[0] ?? null)} />
      <button onClick={() => void run(async () => {
        if (!dvFile || !dvTitle) return;
        await derive(d.id, dvTitle, dvPlatform, dvFile);
        setDvTitle(""); setDvFile(null);
        setDetail(await getAsset(d.id)); void refresh();
      })}>派生</button>
    </div>
  );

  const renderCoverForm = (d: AssetDetail, showDraftNote: boolean) => (
    <div>
      <h3>渲染封面</h3>
      {showDraftNote && (
        <p style={{ color: "#b26b00", margin: "4px 0" }}>建议先定稿，再按平台出图。</p>
      )}
      {platformMeta === null ? (
        <span style={{ color: "#888", fontSize: 14 }}>
          平台列表不可用（meta 接口未响应）
        </span>
      ) : (
        <select value={rcPlatform} onChange={(e) => setRcPlatform(e.target.value)}>
          {coverPlatforms.map((p) => <option key={p}>{p}</option>)}
        </select>
      )}
      <select value={rcRecipeId} onChange={(e) => setRcRecipeId(e.target.value)}>
        <option value="">选择封面模板…</option>
        {coverRecipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <input placeholder="标题" value={rcTitle}
             onChange={(e) => setRcTitle(e.target.value)} />
      <input placeholder="副标题（可选）" value={rcSubtitle}
             onChange={(e) => setRcSubtitle(e.target.value)} />
      <input placeholder='规格覆盖 JSON（可选，如 {"width":900}）' value={rcSpec}
             onChange={(e) => setRcSpec(e.target.value)} />
      <button onClick={() => void run(async () => {
        if (!rcRecipeId || !rcTitle) return;
        let spec: Record<string, unknown> | undefined;
        if (rcSpec.trim()) spec = JSON.parse(rcSpec);
        await renderCover(d.id, rcRecipeId, rcPlatform, rcTitle,
          rcSubtitle || undefined, spec);
        setRcTitle(""); setRcSubtitle(""); setRcSpec("");
        setDetail(await getAsset(d.id)); void refresh();
      })}>渲染</button>
    </div>
  );

  const renderTextVariantForm = (d: AssetDetail) => (
    <div>
      <h3>文本变体</h3>
      <select value={dtRecipeId} onChange={(e) => setDtRecipeId(e.target.value)}>
        <option value="">选择提示词配方…</option>
        {textRecipes.map((r) =>
          <option key={r.id} value={r.id}>
            {r.name}（{RECIPE_KIND_LABELS[r.kind]}）
          </option>)}
      </select>
      <input placeholder="变体标题" value={dtTitle}
             onChange={(e) => setDtTitle(e.target.value)} />
      <textarea placeholder="附加指令（可选）" value={dtInstructions}
                onChange={(e) => setDtInstructions(e.target.value)} rows={2}
                style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }} />
      <button onClick={() => void run(async () => {
        if (!dtRecipeId || !dtTitle) return;
        await deriveText(d.id, dtRecipeId, dtTitle, dtInstructions || undefined);
        setDtTitle(""); setDtInstructions("");
        setDetail(await getAsset(d.id)); void refresh();
      })}>生成变体</button>
    </div>
  );

  const renderVideoKitForm = (d: AssetDetail) => (
    <div>
      <h3>生成视频语音包</h3>
      <select value={vkVoice} onChange={(e) => setVkVoice(e.target.value)}>
        {voiceOptions.map((v) => <option key={v}>{v}</option>)}
      </select>
      <input placeholder="语音包标题（可选）" value={vkTitle}
             onChange={(e) => setVkTitle(e.target.value)} />
      <button onClick={() => void run(async () => {
        await deriveVideoKit(d.id, vkVoice, vkTitle || undefined);
        setVkTitle("");
        setDetail(await getAsset(d.id)); void refresh();
      })}>生成语音包</button>
    </div>
  );

  const renderPublishRegForm = (d: AssetDetail) => (
    <div>
      <h3>发布登记</h3>
      {d.published_url ? (
        <p>
          已登记：<a href={d.published_url}>{d.published_url}</a>
          {d.published_at && <>（{d.published_at.slice(0, 10)}）</>}
        </p>
      ) : <p>未登记发布链接</p>}
      {typeof d.meta?.platform === "string"
        && entryUrls[d.meta.platform.split("·")[0]] && (
        <p>
          <a href={entryUrls[d.meta.platform.split("·")[0]]}
             target="_blank" rel="noreferrer">
            打开平台上传页（{d.meta.platform}）
          </a>
        </p>
      )}
      <input placeholder="https://… 发布链接" value={pubUrl}
             onChange={(e) => setPubUrl(e.target.value)} />
      <button onClick={() => void run(async () => {
        if (!pubUrl) return;
        await publishInfo(d.id, pubUrl);
        setDetail(await getAsset(d.id)); void refresh();
      })}>登记</button>
      {d.published_url && (
        <button onClick={() => void run(async () => {
          await clearPublishInfo(d.id);
          setPubUrl(""); setDetail(await getAsset(d.id)); void refresh();
        })}>清除</button>
      )}
    </div>
  );

  // 任务区：按 primaryTask 渲染唯一展开的主任务
  const renderTask = (key: string | null) => {
    const d = detail;
    if (!d || !key) return null;
    switch (key) {
      case "master_text_drafting":
        return (
          <div>
            <button style={PRIMARY_BTN} onClick={() => void run(async () => {
              await patchStatus(d.id, "finalized");
              setDetail(await getAsset(d.id)); void refresh();
            })}>定稿</button>
            <p style={{ color: "#5a7396", margin: "8px 0 0" }}>
              定稿后解锁文本变体与语音包
            </p>
          </div>
        );
      case "master_text_finalized":
        return d.text_content ? renderTextVariantForm(d) : null;
      case "master_image_finalized":
        return renderCoverForm(d, false);
      case "master_image_drafting":
        return renderCoverForm(d, true); // 未定稿先提示
      case "publish_markdown":
        return d.text_content ? renderVideoKitForm(d) : null;
      case "publish_publishing":
        return renderPublishRegForm(d);
      case "video_kit":
        return (
          <div>
            <h3>视频语音包</h3>
            <p style={{ margin: "4px 0" }}>
              音色：{typeof d.meta.voice === "string" ? d.meta.voice : "—"}
              {typeof d.meta.sentences === "number"
                && <> · 分句 {d.meta.sentences} 句</>}
            </p>
            {d.file_url && (
              <a href={d.file_url} download style={PRIMARY_LINK}>
                下载语音包（zip：音频 + SRT 字幕 + 素材清单）
              </a>
            )}
          </div>
        );
      default:
        return null;
    }
  };
  const taskNode = renderTask(task);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h1>ContentHub · 资产底座</h1>
      <div style={{
        background: "#eef4fb", border: "1px solid #bcd4ec", borderRadius: 6,
        padding: "8px 12px", marginBottom: 12, fontSize: 14,
      }}>
        <strong>内容流水线：</strong>
        {["① 上传母版/源料", "② 定稿", "③ 渲染封面 / 文本变体", "④ 视频语音包", "⑤ 发布登记"].map(
          (s, i) => (
            <span key={s}>
              {i > 0 && <span style={{ margin: "0 6px", color: "#7a9cc4" }}>→</span>}
              <strong>{s}</strong>
            </span>
          ))}
        <div style={{ color: "#5a7396", marginTop: 4 }}>
          点击列表任意一行打开详情；详情面板按资产状态给出「下一步」指引。常用路径：文章母版 →
          文本变体出「口播稿」→ 语音包三件套进剪映；图片母版 → 渲染封面出多平台图。
        </div>
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <section style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">全部区域</option>
          {ZONES.map((z) => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
        </select>
        <input placeholder="搜索标题/正文…" value={q}
               onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => void refresh()}>搜索</button>
      </section>

      {/* 状态快捷筛选 chips：点击即过滤并立即刷新（无需按「搜索」），可与区域/关键词叠加 */}
      <section style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <button key={f.value || "all"} onClick={() => setStatus(f.value)}
                    style={{
                      borderRadius: 999, padding: "4px 14px", fontSize: 14,
                      cursor: "pointer",
                      border: active ? "1px solid #1d6fd2" : "1px solid #bcd4ec",
                      background: active ? "#1d6fd2" : "#fff",
                      color: active ? "#fff" : "#1d6fd2",
                    }}>
              {f.label}
            </button>
          );
        })}
      </section>

      <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 12 }}>
        <h2>上传资产</h2>
        <select value={upZone} onChange={(e) => setUpZone(e.target.value)}>
          <option value="source">源料区</option>
          <option value="master">母版区</option>
        </select>
        <input placeholder="标题" value={upTitle} onChange={(e) => setUpTitle(e.target.value)} />
        <input type="file" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} />
        <button
          disabled={!upFile || !upTitle}
          title={!upFile || !upTitle ? "请先填写标题并选择文件" : undefined}
          style={{ opacity: !upFile || !upTitle ? 0.5 : 1 }}
          onClick={() => void run(async () => {
            if (!upFile) return; // 按钮已 disabled，此处仅为类型收窄
            const a = await uploadAsset(upZone, upTitle, upFile);
            const unlock =
              ["markdown", "docx"].includes(a.content_type) ? "定稿后可生成文本变体，派生口播稿后可出语音包"
              : a.content_type === "image" ? "定稿后可用「渲染封面」按平台出图"
              : "文件已归档；成品建议在母版详情里以「派生发布物」登记";
            setUpResult(`✓ 已入库为 ${ZONE_LABELS[a.zone]}·${STATUS_LABELS[a.status]}（${a.content_type}）——${unlock}`);
            setUpTitle(""); setUpFile(null); void refresh();
          })}
        >上传</button>
        {(!upFile || !upTitle) && (
          <span style={{ marginLeft: 8, color: "#888" }}>填写标题并选择文件后可上传</span>
        )}
        {upResult && (
          <div style={{
            background: "#f0f7ee", border: "1px solid #c4dcc0", borderRadius: 6,
            padding: "6px 10px", marginTop: 8, fontSize: 14,
          }}>{upResult}</div>
        )}
      </section>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">标题</th><th align="left">区域</th>
            <th align="left">状态</th><th align="left">更新时间</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} onClick={() => void run(async () => {
              setDetail(await getAsset(a.id));
            })}
                style={{ cursor: "pointer", borderTop: "1px solid #eee" }}>
              <td>{a.title}</td>
              <td>{ZONE_LABELS[a.zone]}</td>
              <td>{STATUS_LABELS[a.status]}</td>
              <td>{a.updated_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <section ref={detailRef} style={{ border: "1px solid #369", padding: 12, marginTop: 16 }}>
          <h2>{detail.title}</h2>
          <div style={{
            background: "#f0f7ee", border: "1px solid #c4dcc0", borderRadius: 6,
            padding: "6px 10px", marginBottom: 8, fontSize: 14,
          }}>
            <strong>下一步：</strong>{nextStepHint(detail)}
          </div>
          <p>
            {ZONE_LABELS[detail.zone]} · {STATUS_LABELS[detail.status]} · {detail.content_type}
            {detail.source_url && <> · <a href={detail.source_url}>源链接</a></>}
            {detail.file_url && <> · <a href={detail.file_url}>文件</a></>}
          </p>

          {/* 任务区：主任务唯一默认展开；无主任务/无可渲染表单则不显示 */}
          {task && taskNode && (
            <div style={{
              border: "1px solid #9db8d8", background: "#f5f9ff", borderRadius: 6,
              padding: "10px 12px", margin: "8px 0 12px",
            }}>
              <div style={{ fontSize: 13, color: "#5a7396", marginBottom: 6 }}>当前任务</div>
              {taskNode}
            </div>
          )}

          {detail.content_type === "markdown" && detail.text_content && (
            <div style={{ marginTop: 8 }}>
              <h3>生成正文</h3>
              <pre style={{ maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap",
                            background: "#f6f6f6", padding: 12 }}>
                {detail.text_content}
              </pre>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <h3>血缘</h3>
            <p>上游：{detail.upstream.map((d) => d.source_asset_id).join("、") || "无"}</p>
            <p>下游：{detail.downstream.map((d) => d.derived_asset_id).join("、") || "无"}</p>
          </div>

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              更多操作（手动状态流转 / 派生发布物 / 补链 / 删除）
            </summary>
            <div style={{ marginTop: 8 }}>
              <div>
                状态流转：
                {TRANSITIONS[detail.status].map((s) => (
                  <button key={s} onClick={() => void run(async () => {
                    await patchStatus(detail.id, s);
                    setDetail(await getAsset(detail.id)); void refresh();
                  })}>{STATUS_LABELS[s]}</button>
                ))}
              </div>

              {detail.zone === "master" && (
                <div style={{ marginTop: 8 }}>{renderDeriveForm(detail)}</div>
              )}

              {/* 图片母版已进入发布流程时，渲染封面不再是主任务，保留在此 */}
              {detail.zone === "master" && detail.content_type === "image"
                && task !== "master_image_finalized" && task !== "master_image_drafting" && (
                <div style={{ marginTop: 8 }}>{renderCoverForm(detail, false)}</div>
              )}

              {/* 文本母版已进入发布流程时，文本变体保留在此 */}
              {detail.zone === "master" && detail.text_content
                && (detail.status === "publishing" || detail.status === "published") && (
                <div style={{ marginTop: 8 }}>{renderTextVariantForm(detail)}</div>
              )}

              {/* 非「发布中」主任务的发布资产，登记/清除入口保留在此 */}
              {detail.zone === "publish" && task !== "publish_publishing" && (
                <div style={{ marginTop: 8 }}>{renderPublishRegForm(detail)}</div>
              )}

              {/* 已发布的文本发布物，语音包生成入口保留在此 */}
              {detail.zone === "publish" && detail.content_type === "markdown"
                && detail.text_content && task !== "publish_markdown" && (
                <div style={{ marginTop: 8 }}>{renderVideoKitForm(detail)}</div>
              )}

              <div style={{ marginTop: 8 }}>
                <h3>补链</h3>
                <input placeholder="补链：上游资产 UUID" value={linkSource}
                       onChange={(e) => setLinkSource(e.target.value)} />
                <button onClick={() => void run(async () => {
                  await linkDerivation(detail.id, linkSource);
                  setLinkSource(""); setDetail(await getAsset(detail.id));
                })}>补链</button>
              </div>

              <div style={{ marginTop: 8 }}>
                <button onClick={() => void run(async () => {
                  await deleteAsset(detail.id); setDetail(null); void refresh();
                })}>删除资产</button>
              </div>
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
