import { useCallback, useEffect, useState } from "react";
import {
  clearPublishInfo, deleteAsset, derive, deriveText, getAsset, linkDerivation,
  listAssets, listRecipes, patchStatus, publishInfo, renderCover, uploadAsset,
} from "./api";
import {
  PUBLISH_ENTRY_URLS, RECIPE_KIND_LABELS, STATUS_LABELS, TRANSITIONS,
  ZONE_LABELS, type Asset, type AssetDetail, type Recipe, type Zone,
} from "./types";
import Recipes from "./Recipes";

const ZONES: Zone[] = ["source", "master", "publish"];
const PLATFORMS = ["微信公众号", "抖音", "微信视频号", "哔哩哔哩"];

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
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");

  // 上传表单
  const [upZone, setUpZone] = useState<string>("master");
  const [upTitle, setUpTitle] = useState("");
  const [upFile, setUpFile] = useState<File | null>(null);
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

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets({ zone, q }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [zone, q]);

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
    if (!detail) return;
    void getAsset(detail.id).then((d) => { setDetail(d); setPubUrl(d.published_url ?? ""); })
      .catch(() => setDetail(null));
  }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h1>ContentHub · 资产底座</h1>
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

      <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 12 }}>
        <h2>上传资产</h2>
        <select value={upZone} onChange={(e) => setUpZone(e.target.value)}>
          <option value="source">源料区</option>
          <option value="master">母版区</option>
        </select>
        <input placeholder="标题" value={upTitle} onChange={(e) => setUpTitle(e.target.value)} />
        <input type="file" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} />
        <button onClick={() => void run(async () => {
          if (!upFile || !upTitle) return;
          await uploadAsset(upZone, upTitle, upFile);
          setUpTitle(""); setUpFile(null); void refresh();
        })}>上传</button>
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
        <section style={{ border: "1px solid #369", padding: 12, marginTop: 16 }}>
          <h2>{detail.title}</h2>
          <p>
            {ZONE_LABELS[detail.zone]} · {STATUS_LABELS[detail.status]} · {detail.content_type}
            {detail.source_url && <> · <a href={detail.source_url}>源链接</a></>}
            {detail.file_url && <> · <a href={detail.file_url}>文件</a></>}
          </p>

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
            <div style={{ marginTop: 8 }}>
              <h3>派生发布物</h3>
              <select value={dvPlatform} onChange={(e) => setDvPlatform(e.target.value)}>
                {["微信公众号", "抖音", "微信视频号", "哔哩哔哩", "官网"].map((p) =>
                  <option key={p}>{p}</option>)}
              </select>
              <input placeholder="发布物标题" value={dvTitle}
                     onChange={(e) => setDvTitle(e.target.value)} />
              <input type="file" onChange={(e) => setDvFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => void run(async () => {
                if (!dvFile || !dvTitle) return;
                await derive(detail.id, dvTitle, dvPlatform, dvFile);
                setDvTitle(""); setDvFile(null);
                setDetail(await getAsset(detail.id)); void refresh();
              })}>派生</button>
            </div>
          )}

          {detail.zone === "master" && detail.content_type === "image" && (
            <div style={{ marginTop: 8 }}>
              <h3>渲染封面</h3>
              <select value={rcPlatform} onChange={(e) => setRcPlatform(e.target.value)}>
                {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
              </select>
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
                await renderCover(detail.id, rcRecipeId, rcPlatform, rcTitle,
                  rcSubtitle || undefined, spec);
                setRcTitle(""); setRcSubtitle(""); setRcSpec("");
                setDetail(await getAsset(detail.id)); void refresh();
              })}>渲染</button>
            </div>
          )}

          {detail.zone === "master" && detail.text_content && (
            <div style={{ marginTop: 8 }}>
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
                await deriveText(detail.id, dtRecipeId, dtTitle, dtInstructions || undefined);
                setDtTitle(""); setDtInstructions("");
                setDetail(await getAsset(detail.id)); void refresh();
              })}>生成变体</button>
            </div>
          )}

          {detail.zone === "publish" && (
            <div style={{ marginTop: 8 }}>
            <h3>发布登记</h3>
            {detail.published_url ? (
              <p>
                已登记：<a href={detail.published_url}>{detail.published_url}</a>
                {detail.published_at && <>（{detail.published_at.slice(0, 10)}）</>}
              </p>
            ) : <p>未登记发布链接</p>}
            {typeof detail.meta?.platform === "string"
              && PUBLISH_ENTRY_URLS[detail.meta.platform] && (
              <p>
                <a href={PUBLISH_ENTRY_URLS[detail.meta.platform]}
                   target="_blank" rel="noreferrer">
                  打开平台上传页（{detail.meta.platform}）
                </a>
              </p>
            )}
            <input placeholder="https://… 发布链接" value={pubUrl}
                   onChange={(e) => setPubUrl(e.target.value)} />
            <button onClick={() => void run(async () => {
              if (!pubUrl) return;
              await publishInfo(detail.id, pubUrl);
              setDetail(await getAsset(detail.id)); void refresh();
            })}>登记</button>
            {detail.published_url && (
              <button onClick={() => void run(async () => {
                await clearPublishInfo(detail.id);
                setPubUrl(""); setDetail(await getAsset(detail.id)); void refresh();
              })}>清除</button>
            )}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <h3>血缘</h3>
            <p>上游：{detail.upstream.map((d) => d.source_asset_id).join("、") || "无"}</p>
            <p>下游：{detail.downstream.map((d) => d.derived_asset_id).join("、") || "无"}</p>
            <input placeholder="补链：上游资产 UUID" value={linkSource}
                   onChange={(e) => setLinkSource(e.target.value)} />
            <button onClick={() => void run(async () => {
              await linkDerivation(detail.id, linkSource);
              setLinkSource(""); setDetail(await getAsset(detail.id));
            })}>补链</button>
          </div>

          <button style={{ marginTop: 8 }} onClick={() => void run(async () => {
            await deleteAsset(detail.id); setDetail(null); void refresh();
          })}>删除资产</button>
        </section>
      )}
    </main>
  );
}
