export type Zone = "source" | "master" | "publish";
export type Status = "topic" | "drafting" | "finalized" | "publishing" | "published";

export const TRANSITIONS: Record<Status, Status[]> = {
  topic: ["drafting"],
  drafting: ["finalized"],
  finalized: ["drafting", "publishing"],
  publishing: ["finalized", "published"],
  published: [],
};

export interface Asset {
  id: string;
  zone: Zone;
  status: Status;
  title: string;
  file_name: string | null;
  content_type: string;
  source_url: string | null;
  created_by: string;
  meta: Record<string, unknown>;
  updated_at: string;
}

export interface Derivation {
  id: string;
  source_asset_id: string;
  derived_asset_id: string;
  recipe_ref: string | null;
  note: string | null;
}

export interface AssetDetail extends Asset {
  upstream: Derivation[];
  downstream: Derivation[];
  file_url: string | null;
  text_content: string | null;
  published_url: string | null;
  published_at: string | null;
}

export type RecipeKind = "cover_template" | "text_prompt";

export interface Recipe {
  id: string;
  kind: RecipeKind;
  name: string;
  description: string | null;
  content: string;
  meta: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const RECIPE_KIND_LABELS: Record<RecipeKind, string> = {
  cover_template: "封面模板",
  text_prompt: "文本提示词",
};

// 平台常量（发布页 URL / 封面规格 / 音色）不再前端硬编码：
// 运行时经 GET /api/meta/platforms 获取（见 api.ts fetchPlatformMeta）。

export const ZONE_LABELS: Record<Zone, string> = {
  source: "源料区",
  master: "母版区",
  publish: "发布态",
};

export const STATUS_LABELS: Record<Status, string> = {
  topic: "选题",
  drafting: "创作中",
  finalized: "定稿",
  publishing: "发布中",
  published: "已发布",
};
