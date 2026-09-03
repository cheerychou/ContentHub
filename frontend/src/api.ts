import type { Asset, AssetDetail } from "./types";

const base = "/api";

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
  return resp.json();
}

export async function uploadAsset(
  zone: string, title: string, file: File
): Promise<Asset> {
  const form = new FormData();
  form.append("zone", zone);
  form.append("title", title);
  form.append("file", file);
  const resp = await fetch(`${base}/assets`, { method: "POST", body: form });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "上传失败");
  return resp.json();
}

export async function patchStatus(id: string, status: string): Promise<Asset> {
  const resp = await fetch(`${base}/assets/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "状态更新失败");
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
  if (!resp.ok) throw new Error((await resp.json()).detail ?? "派生失败");
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
    throw new Error((await resp.json()).detail ?? "补链失败");
}

export async function deleteAsset(id: string): Promise<void> {
  const resp = await fetch(`${base}/assets/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("删除失败");
}
