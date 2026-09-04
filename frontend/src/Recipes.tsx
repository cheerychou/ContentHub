import { useCallback, useEffect, useState } from "react";
import { createRecipe, deleteRecipe, listRecipes } from "./api";
import {
  RECIPE_KIND_LABELS, type Recipe, type RecipeKind,
} from "./types";

const KINDS: RecipeKind[] = ["cover_template", "text_prompt"];

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [kind, setKind] = useState<string>("");
  const [error, setError] = useState("");

  // 新建表单
  const [nkKind, setNkKind] = useState<RecipeKind>("cover_template");
  const [nkName, setNkName] = useState("");
  const [nkDesc, setNkDesc] = useState("");
  const [nkContent, setNkContent] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRecipes(await listRecipes(kind || undefined));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    try { setError(""); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h1>ContentHub · 配方管理</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <section style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">全部类型</option>
          {KINDS.map((k) => <option key={k} value={k}>{RECIPE_KIND_LABELS[k]}</option>)}
        </select>
        <button onClick={() => void refresh()}>刷新</button>
      </section>

      <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 12 }}>
        <h2>新建配方</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select value={nkKind} onChange={(e) => setNkKind(e.target.value as RecipeKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{RECIPE_KIND_LABELS[k]}</option>)}
          </select>
          <input placeholder="名称" value={nkName} onChange={(e) => setNkName(e.target.value)} />
          <input placeholder="描述（可选）" value={nkDesc}
                 onChange={(e) => setNkDesc(e.target.value)} style={{ flexGrow: 1 }} />
        </div>
        <textarea placeholder="配方内容（模板 / 提示词，支持 {title} 等占位符）"
                  value={nkContent} onChange={(e) => setNkContent(e.target.value)}
                  rows={5} style={{ width: "100%", boxSizing: "border-box" }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={() => void run(async () => {
            if (!nkName || !nkContent) return;
            await createRecipe({
              kind: nkKind, name: nkName, content: nkContent,
              ...(nkDesc ? { description: nkDesc } : {}),
            });
            setNkName(""); setNkDesc(""); setNkContent(""); void refresh();
          })}>创建</button>
        </div>
      </section>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">名称</th><th align="left">类型</th>
            <th align="left">描述</th><th align="left">更新时间</th><th></th>
          </tr>
        </thead>
        <tbody>
          {recipes.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
              <td>{r.name}</td>
              <td>{RECIPE_KIND_LABELS[r.kind]}</td>
              <td>{r.description || "—"}</td>
              <td>{r.updated_at.slice(0, 10)}</td>
              <td>
                <button onClick={() => void run(async () => {
                  await deleteRecipe(r.id); void refresh();
                })}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
