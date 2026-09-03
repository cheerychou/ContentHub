import type { Asset, AssetDetail } from "./types";

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
