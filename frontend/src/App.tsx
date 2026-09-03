import { useCallback, useEffect, useState } from "react";
import {
  deleteAsset, derive, getAsset, linkDerivation, listAssets, patchStatus, uploadAsset,
} from "./api";
import {
  STATUS_LABELS, TRANSITIONS, ZONE_LABELS, type Asset, type AssetDetail, type Zone,
} from "./types";

const ZONES: Zone[] = ["source", "master", "publish"];

export default function App() {
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

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets({ zone, q }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [zone, q]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!detail) return;
    void getAsset(detail.id).then(setDetail).catch(() => setDetail(null));
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
        <button onClick={async () => {
          if (!upFile || !upTitle) return;
          await uploadAsset(upZone, upTitle, upFile);
          setUpTitle(""); setUpFile(null); void refresh();
        }}>上传</button>
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
            <tr key={a.id} onClick={() => void getAsset(a.id).then(setDetail)}
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
              <button key={s} onClick={async () => {
                await patchStatus(detail.id, s);
                setDetail(await getAsset(detail.id)); void refresh();
              }}>{STATUS_LABELS[s]}</button>
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
              <button onClick={async () => {
                if (!dvFile || !dvTitle) return;
                await derive(detail.id, dvTitle, dvPlatform, dvFile);
                setDvTitle(""); setDvFile(null);
                setDetail(await getAsset(detail.id)); void refresh();
              }}>派生</button>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <h3>血缘</h3>
            <p>上游：{detail.upstream.map((d) => d.source_asset_id).join("、") || "无"}</p>
            <p>下游：{detail.downstream.map((d) => d.derived_asset_id).join("、") || "无"}</p>
            <input placeholder="补链：上游资产 UUID" value={linkSource}
                   onChange={(e) => setLinkSource(e.target.value)} />
            <button onClick={async () => {
              await linkDerivation(detail.id, linkSource);
              setLinkSource(""); setDetail(await getAsset(detail.id));
            }}>补链</button>
          </div>

          <button style={{ marginTop: 8 }} onClick={async () => {
            await deleteAsset(detail.id); setDetail(null); void refresh();
          }}>删除资产</button>
        </section>
      )}
    </main>
  );
}
