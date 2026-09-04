import type { Asset, AssetDetail, Recipe, RecipeKind } from "./types";

const base = "/api";

async function errDetail(resp: Response): Promise<string> {
  try { const j = await resp.json(); return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j); }
  catch { return `请求失败 ${resp.status}`; }
}

export async function listAssets(params: {
  zone?: string; status?: string; q?: string;
}): Promise<Asset[]> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][]
  );
  const resp = await fetch(`${base}/assets?${qs}`);
  if (!resp.ok) throw new Error(`列表失败 ${resp.status}`);
  return resp.json();
}

export async function getAsset(id: string): Promise<AssetDetail> {
  const resp = await fetch(`${base}/assets/${id}`);
  if (!resp.ok) throw new Error(`详情失败 ${resp.status}`);
  const detail: AssetDetail = await resp.json();
  if (detail.file_url) detail.file_url = detail.file_url.replace(/^https?:\/\/minio:9000/, "/minio");
  return detail;
}

export async function uploadAsset(
  zone: string, title: string, file: File
): Promise<Asset> {
  const form = new FormData();
  form.append("zone", zone);
  form.append("title", title);
  form.append("file", file);
  const resp = await fetch(`${base}/assets`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function patchStatus(id: string, status: string): Promise<Asset> {
  const resp = await fetch(`${base}/assets/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function derive(
  masterId: string, title: string, platform: string, file: File
): Promise<AssetDetail> {
  const form = new FormData();
  form.append("title", title);
  form.append("platform", platform);
  form.append("file", file);
  const resp = await fetch(`${base}/assets/${masterId}/derive`, {
    method: "POST", body: form,
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function linkDerivation(
  derivedId: string, sourceAssetId: string
): Promise<void> {
  const resp = await fetch(`${base}/assets/${derivedId}/derivations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_asset_id: sourceAssetId }),
  });
  if (!resp.ok && resp.status !== 409)
    throw new Error(await errDetail(resp));
}

export async function deleteAsset(id: string): Promise<void> {
  const resp = await fetch(`${base}/assets/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除失败");
}

export async function listRecipes(kind?: string): Promise<Recipe[]> {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  const resp = await fetch(`${base}/recipes${qs}`);
  if (!resp.ok) throw new Error(`配方列表失败 ${resp.status}`);
  return resp.json();
}

export async function createRecipe(body: {
  kind: RecipeKind; name: string; description?: string; content: string; meta?: Record<string, unknown>;
}): Promise<Recipe> {
  const resp = await fetch(`${base}/recipes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function updateRecipe(
  id: string, body: { kind?: RecipeKind; name?: string; description?: string; content?: string; meta?: Record<string, unknown> }
): Promise<Recipe> {
  const resp = await fetch(`${base}/recipes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function deleteRecipe(id: string): Promise<void> {
  const resp = await fetch(`${base}/recipes/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除配方失败");
}

export async function renderCover(
  masterId: string, recipeId: string, platform: string,
  title: string, subtitle?: string, spec?: Record<string, unknown>
): Promise<AssetDetail> {
  const form = new FormData();
  form.append("recipe_id", recipeId);
  form.append("platform", platform);
  form.append("title", title);
  if (subtitle) form.append("subtitle", subtitle);
  if (spec) form.append("spec", JSON.stringify(spec));
  const resp = await fetch(`${base}/assets/${masterId}/render-cover`, {
    method: "POST", body: form,
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function deriveText(
  masterId: string, recipeId: string, title: string, instructions?: string
): Promise<AssetDetail> {
  const resp = await fetch(`${base}/assets/${masterId}/derive-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipe_id: recipeId, title,
      ...(instructions ? { instructions } : {}),
    }),
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function publishInfo(id: string, publishedUrl: string): Promise<Asset> {
  const resp = await fetch(`${base}/assets/${id}/publish-info`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ published_url: publishedUrl }),
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export async function clearPublishInfo(id: string): Promise<Asset> {
  const resp = await fetch(`${base}/assets/${id}/publish-info`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true }),
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}

export interface PlatformMeta {
  cover: string[];
  entry_urls: Record<string, string>;
  voices: Record<string, string>;
}

export async function fetchPlatformMeta(): Promise<PlatformMeta> {
  const resp = await fetch(`${base}/meta/platforms`);
  if (!resp.ok) throw new Error(`平台常量获取失败 ${resp.status}`);
  return resp.json();
}

export async function deriveVideoKit(
  masterId: string, voice: string, title?: string
): Promise<AssetDetail> {
  const form = new FormData();
  form.append("voice", voice);
  if (title) form.append("title", title);
  const resp = await fetch(`${base}/assets/${masterId}/derive-video-kit`, {
    method: "POST", body: form,
  });
  if (!resp.ok) throw new Error(await errDetail(resp));
  return resp.json();
}
