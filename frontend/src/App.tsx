import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearPublishInfo, deleteAsset, derive, deriveText, deriveVideoKit, getAsset,
  fetchPlatformMeta, initialDraft, linkDerivation, listAssets, listRecipes,
  patchStatus, publishInfo, renderCover, uploadAsset, type PlatformMeta,
} from "./api";
import {
  RECIPE_KIND_LABELS, STATUS_LABELS, ZONE_LABELS, ZONE_STATUSES,
  ZONE_TRANSITIONS, type Asset, type AssetDetail, type Recipe, type Status, type Zone,
} from "./types";
import Recipes from "./Recipes";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";

// 四阶段工作台（M4）：导航即区域选择器；STAGES 同时驱动左导航与路由解析
const STAGES: { zone: Zone; hash: string; icon: string; label: string }[] = [
  { zone: "source", hash: "#/source", icon: "📚", label: "素材库" },
  { zone: "topic", hash: "#/topic", icon: "📝", label: "选题策划" },
  { zone: "master", hash: "#/master", icon: "🎬", label: "内容制作" },
  { zone: "publish", hash: "#/publish", icon: "📤", label: "内容发布" },
];

// 状态驱动的「下一步」指引（流程导向，降低学习成本）
function nextStepHint(d: AssetDetail): string {
  if (d.zone === "topic") {
    if (d.status === "candidate") return "推进到调研中";
    if (d.status === "researching") return "调研充分后点「已立项」";
    if (d.status === "approved") return "用「产出初始文稿」把选题落成素材";
    return "搁置中，可重启为候选";
  }
  if (d.zone === "source") {
    return "素材（底片）可供制作引用。要加工内容，请到「内容制作」页另传母版。";
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

// 状态 → StatusBadge tone 映射（frontend/COMPONENTS.md §6）
const STATUS_TONES: Record<Status, StatusTone> = {
  available: "success", published: "success", finalized: "success",
  researching: "info", approved: "info", drafting: "info",
  publishing: "warning",
  candidate: "default", shelved: "default", topic: "default",
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
  if (d.zone === "topic") {
    // 候选/调研中/已立项/已搁置 → 阶段推进任务（按钮或产出文稿表单，见 renderTask）
    if (["candidate", "researching", "approved", "shelved"].includes(d.status))
      return "topic_stage";
    return null; // available 等：选题区无该状态
  }
  return null; // source：素材（底片）无主任务，看指引与血缘即可
}

function useHashRoute(): string {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const f = () => setRoute(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return route;
}

// 单条左导航项：激活态用 Button variant 区分（hash 导航行为不变，效率优先不引 sidebar 全家桶）
function NavItem(props: { href: string; label: string; active: boolean }) {
  return (
    <a href={props.href}
       className={cn(buttonVariants({
         variant: props.active ? "default" : "ghost",
       }), "w-full justify-start", !props.active && "font-normal")}>
      {props.label}
    </a>
  );
}

function Nav({ route }: { route: string }) {
  return (
    <nav className="flex w-[150px] shrink-0 flex-col gap-1 border-r p-3">
      {STAGES.map((s) => (
        <NavItem key={s.hash} href={s.hash} label={`${s.icon} ${s.label}`}
                 active={route.startsWith(s.hash)} />
      ))}
      <NavItem href="#/recipes" label="⚙️ 提示词与模板" active={route.startsWith("#/recipes")} />
    </nav>
  );
}

export default function App() {
  const route = useHashRoute();
  // #/ 重定向到 #/source（默认进入素材库）
  useEffect(() => {
    if (route === "" || route === "#" || route === "#/") location.replace("#/source");
  }, [route]);

  const stage = STAGES.find((s) => route.startsWith(s.hash));
  const stageZone: Zone = stage?.zone ?? "source";

  return (
    <div className="flex min-h-screen">
      <Nav route={route} />
      <div className="min-w-0 flex-1">
        {route.startsWith("#/recipes")
          ? <Recipes />
          : <Assets key={stageZone} stageZone={stageZone} />}
      </div>
    </div>
  );
}

function Assets({ stageZone }: { stageZone: Zone }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const detailRef = useRef<HTMLElement | null>(null);

  // 状态快捷筛选 chips：全部 + 本阶段词表（label 复用 STATUS_LABELS，与表格状态列一致）
  const statusFilters: { value: string; label: string }[] = [
    { value: "", label: "全部" },
    ...ZONE_STATUSES[stageZone].map((s) => ({ value: s, label: STATUS_LABELS[s] })),
  ];

  // 详情面板在长列表下方：打开/更新时自动滚入视野
  useEffect(() => {
    if (detail) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail]);

  // 上传表单（素材库/选题策划/内容制作三页显示；发布页无上传——发布物靠派生）
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
  // 模板与提示词缓存
  const [coverRecipes, setCoverRecipes] = useState<Recipe[]>([]);
  const [textRecipes, setTextRecipes] = useState<Recipe[]>([]);
  // 发布登记
  const [pubUrl, setPubUrl] = useState("");
  // 平台常量（启动时拉取一次；失败保持 null：隐藏平台下拉并提示不可用）
  const [platformMeta, setPlatformMeta] = useState<PlatformMeta | null>(null);
  // 视频语音包表单
  const [vkVoice, setVkVoice] = useState("晓晓（女）");
  const [vkTitle, setVkTitle] = useState("");
  // 产出初始文稿表单（已立项选题）
  const [idTitle, setIdTitle] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets({ zone: stageZone, status, q }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [stageZone, status, q]);

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
  const stageInfo = STAGES.find((s) => s.zone === stageZone);

  // —— 表单渲染助手：同一表单可能出现在任务区或更多操作，抽成函数避免重复 JSX ——
  // 全部沿用原有提交逻辑与 run 错误处理，仅替换为 ui 组件（Input/Select/Textarea/Button）。
  const renderDeriveForm = (d: AssetDetail) => (
    <div>
      <h3 className="text-sm font-semibold">派生发布物</h3>
      <p className="my-1 text-sm text-muted-foreground">
        用于登记<strong>已做好的成品文件</strong>（如剪映导出的成片、别处做好的版本）。
        要自动生成封面 → 请先上传图片母版，用它的「渲染封面」。
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <Select value={dvPlatform} onValueChange={(v) => setDvPlatform(v as string)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {["微信公众号", "抖音", "微信视频号", "哔哩哔哩", "官网"].map((p) =>
              <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="发布物标题" value={dvTitle}
               onChange={(e) => setDvTitle(e.target.value)} />
        <Label>
          文件
          <Input type="file" onChange={(e) => setDvFile(e.target.files?.[0] ?? null)} />
        </Label>
        <Button onClick={() => void run(async () => {
          if (!dvFile || !dvTitle) return;
          await derive(d.id, dvTitle, dvPlatform, dvFile);
          setDvTitle(""); setDvFile(null);
          setDetail(await getAsset(d.id)); void refresh();
        })}>派生</Button>
      </div>
    </div>
  );

  const renderCoverForm = (d: AssetDetail, showDraftNote: boolean) => (
    <div>
      <h3 className="text-sm font-semibold">渲染封面</h3>
      {showDraftNote && (
        <p className="my-1 text-sm text-warning">建议先定稿，再按平台出图。</p>
      )}
      {platformMeta === null ? (
        <span className="text-sm text-muted-foreground">
          平台列表不可用（meta 接口未响应）
        </span>
      ) : (
        <Select value={rcPlatform} onValueChange={(v) => setRcPlatform(v as string)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {coverPlatforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div className="mt-2 flex flex-col gap-2">
        <Select value={rcRecipeId} onValueChange={(v) => setRcRecipeId(v as string)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">选择封面模板…</SelectItem>
            {coverRecipes.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="标题" value={rcTitle}
               onChange={(e) => setRcTitle(e.target.value)} />
        <Input placeholder="副标题（可选）" value={rcSubtitle}
               onChange={(e) => setRcSubtitle(e.target.value)} />
        <Input placeholder='规格覆盖 JSON（可选，如 {"width":900}）' value={rcSpec}
               onChange={(e) => setRcSpec(e.target.value)} />
        <Button onClick={() => void run(async () => {
          if (!rcRecipeId || !rcTitle) return;
          let spec: Record<string, unknown> | undefined;
          if (rcSpec.trim()) spec = JSON.parse(rcSpec);
          await renderCover(d.id, rcRecipeId, rcPlatform, rcTitle,
            rcSubtitle || undefined, spec);
          setRcTitle(""); setRcSubtitle(""); setRcSpec("");
          setDetail(await getAsset(d.id)); void refresh();
        })}>渲染</Button>
      </div>
    </div>
  );

  const renderTextVariantForm = (d: AssetDetail) => (
    <div>
      <h3 className="text-sm font-semibold">文本变体</h3>
      <div className="mt-2 flex flex-col gap-2">
        <Select value={dtRecipeId} onValueChange={(v) => setDtRecipeId(v as string)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">选择提示词…</SelectItem>
            {textRecipes.map((r) =>
              <SelectItem key={r.id} value={r.id}>
                {r.name}（{RECIPE_KIND_LABELS[r.kind]}）
              </SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="变体标题" value={dtTitle}
               onChange={(e) => setDtTitle(e.target.value)} />
        <Textarea placeholder="附加指令（可选）" value={dtInstructions}
                  onChange={(e) => setDtInstructions(e.target.value)} rows={2} />
        <Button onClick={() => void run(async () => {
          if (!dtRecipeId || !dtTitle) return;
          await deriveText(d.id, dtRecipeId, dtTitle, dtInstructions || undefined);
          setDtTitle(""); setDtInstructions("");
          setDetail(await getAsset(d.id)); void refresh();
        })}>生成变体</Button>
      </div>
    </div>
  );

  const renderVideoKitForm = (d: AssetDetail) => (
    <div>
      <h3 className="text-sm font-semibold">生成视频语音包</h3>
      <div className="mt-2 flex flex-col gap-2">
        <Select value={vkVoice} onValueChange={(v) => setVkVoice(v as string)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {voiceOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="语音包标题（可选）" value={vkTitle}
               onChange={(e) => setVkTitle(e.target.value)} />
        <Button onClick={() => void run(async () => {
          await deriveVideoKit(d.id, vkVoice, vkTitle || undefined);
          setVkTitle("");
          setDetail(await getAsset(d.id)); void refresh();
        })}>生成语音包</Button>
      </div>
    </div>
  );

  // 产出初始文稿表单（已立项选题 → 源料区 available 文稿，后端记 topic→source 血缘）
  const renderInitialDraftForm = (d: AssetDetail) => (
    <div>
      <h3 className="text-sm font-semibold">产出初始文稿</h3>
      <div className="mt-2 flex flex-col gap-2">
        <Input placeholder="文稿标题" value={idTitle}
               onChange={(e) => setIdTitle(e.target.value)} />
        <Label>
          文件（md / docx）
          <Input type="file" accept=".md,.docx"
                 onChange={(e) => setIdFile(e.target.files?.[0] ?? null)} />
        </Label>
        <Button
          disabled={!idFile || !idTitle}
          title={!idFile || !idTitle ? "请先填写标题并选择 md/docx 文件" : undefined}
          onClick={() => void run(async () => {
            if (!idFile) return; // 按钮已 disabled，此处仅为类型收窄
            await initialDraft(d.id, idTitle, idFile);
            setIdTitle(""); setIdFile(null);
            setDetail(await getAsset(d.id)); void refresh();
          })}
        >产出文稿</Button>
        <p className="mt-0 text-sm text-muted-foreground">
          文稿将入素材库并记录与本选题的血缘
        </p>
      </div>
    </div>
  );

  const renderPublishRegForm = (d: AssetDetail) => (
    <div>
      <h3 className="text-sm font-semibold">发布登记</h3>
      {d.published_url ? (
        <p className="my-1 text-sm">
          已登记：<a className="text-primary hover:underline" href={d.published_url}>{d.published_url}</a>
          {d.published_at && <>（{d.published_at.slice(0, 10)}）</>}
        </p>
      ) : <p className="my-1 text-sm">未登记发布链接</p>}
      {typeof d.meta?.platform === "string"
        && entryUrls[d.meta.platform.split("·")[0]] && (
        <p className="my-1 text-sm">
          <a className="text-primary hover:underline"
             href={entryUrls[d.meta.platform.split("·")[0]]}
             target="_blank" rel="noreferrer">
            打开平台上传页（{d.meta.platform}）
          </a>
        </p>
      )}
      <div className="mt-2 flex flex-col gap-2">
        <Input placeholder="https://… 发布链接" value={pubUrl}
               onChange={(e) => setPubUrl(e.target.value)} />
        <div className="flex items-center gap-2">
          <Button onClick={() => void run(async () => {
            if (!pubUrl) return;
            await publishInfo(d.id, pubUrl);
            setDetail(await getAsset(d.id)); void refresh();
          })}>登记</Button>
          {d.published_url && (
            <Button variant="outline" onClick={() => void run(async () => {
              await clearPublishInfo(d.id);
              setPubUrl(""); setDetail(await getAsset(d.id)); void refresh();
            })}>清除</Button>
          )}
        </div>
      </div>
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
            <Button size="lg" onClick={() => void run(async () => {
              await patchStatus(d.id, "finalized");
              setDetail(await getAsset(d.id)); void refresh();
            })}>定稿</Button>
            <p className="mt-2 text-sm text-muted-foreground">
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
            <h3 className="text-sm font-semibold">视频语音包</h3>
            <p className="my-1 text-sm">
              音色：{typeof d.meta.voice === "string" ? d.meta.voice : "—"}
              {typeof d.meta.sentences === "number"
                && <> · 分句 {d.meta.sentences} 句</>}
            </p>
            {d.file_url && (
              <a href={d.file_url} download
                 className={cn(buttonVariants({ size: "lg" }), "mt-1")}>
                下载语音包（zip：音频 + SRT 字幕 + 素材清单）
              </a>
            )}
          </div>
        );
      case "topic_stage": {
        // 选题阶段推进（与后端 topic 状态机一致：candidate→researching→approved；shelved↔candidate）
        if (d.status === "candidate" || d.status === "researching") {
          const next = d.status === "candidate" ? "researching" : "approved";
          return (
            <div className="flex items-center gap-2">
              <Button size="lg" onClick={() => void run(async () => {
                await patchStatus(d.id, next);
                setDetail(await getAsset(d.id)); void refresh();
              })}>{d.status === "candidate" ? "推进到调研中" : "已立项"}</Button>
              <Button size="lg" variant="outline" onClick={() => void run(async () => {
                await patchStatus(d.id, "shelved");
                setDetail(await getAsset(d.id)); void refresh();
              })}>搁置</Button>
            </div>
          );
        }
        if (d.status === "approved") return renderInitialDraftForm(d);
        if (d.status === "shelved") {
          return (
            <div>
              <Button size="lg" onClick={() => void run(async () => {
                await patchStatus(d.id, "candidate");
                setDetail(await getAsset(d.id)); void refresh();
              })}>重启为候选</Button>
            </div>
          );
        }
        return null;
      }
      default:
        return null;
    }
  };
  const taskNode = renderTask(task);

  return (
    <main className="mx-auto max-w-[1100px] p-4">
      <PageHeader
        title="ContentHub · 四阶段工作台"
        subtitle={`当前阶段：${stageInfo?.label ?? ZONE_LABELS[stageZone]}`}
        description="内容流水线：① 上传母版/源料 → ② 定稿 → ③ 渲染封面 / 文本变体 → ④ 视频语音包 → ⑤ 发布登记"
      />
      <p className="mt-2 text-sm text-muted-foreground">
        点击列表任意一行打开详情；详情面板按资产状态给出「下一步」指引。常用路径：文章母版 →
        文本变体出「口播稿」→ 语音包三件套进剪映；图片母版 → 渲染封面出多平台图。
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* 阶段页固定 zone：左导航即区域选择器，列表查询强制带 zone */}
      <section className="mb-3 mt-4 flex gap-2">
        <Input placeholder="搜索标题/正文…" value={q}
               onChange={(e) => setQ(e.target.value)} />
        <Button variant="outline" onClick={() => void refresh()}>搜索</Button>
      </section>

      {/* 状态快捷筛选 chips：点击即过滤并立即刷新（无需按「搜索」），可与关键词叠加 */}
      <section className="mb-3 flex items-center gap-2">
        {statusFilters.map((f) => {
          const active = status === f.value;
          return (
            <Button key={f.value || "all"} size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => setStatus(f.value)}>
              {f.label}
            </Button>
          );
        })}
      </section>

      {/* 上传表单仅素材库/选题策划/内容制作三页显示；上传目标即当前阶段区 */}
      {stageZone !== "publish" && (
        <Card className="mb-3">
          <CardHeader>
            <CardTitle>上传资产（入库到{stageInfo?.label ?? ZONE_LABELS[stageZone]}）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Input placeholder="标题" value={upTitle} onChange={(e) => setUpTitle(e.target.value)} />
              <Label>
                文件
                <Input type="file" onChange={(e) => setUpFile(e.target.files?.[0] ?? null)} />
              </Label>
              <div className="flex items-center gap-2">
                <Button
                  disabled={!upFile || !upTitle}
                  title={!upFile || !upTitle ? "请先填写标题并选择文件" : undefined}
                  onClick={() => void run(async () => {
                    if (!upFile) return; // 按钮已 disabled，此处仅为类型收窄
                    const a = await uploadAsset(stageZone, upTitle, upFile);
                    const unlock =
                      ["markdown", "docx"].includes(a.content_type) ? "定稿后可生成文本变体，派生口播稿后可出语音包"
                      : a.content_type === "image" ? "定稿后可用「渲染封面」按平台出图"
                      : "文件已归档；成品建议在母版详情里以「派生发布物」登记";
                    setUpResult(`✓ 已入库为 ${ZONE_LABELS[a.zone]}·${STATUS_LABELS[a.status]}（${a.content_type}）——${unlock}`);
                    setUpTitle(""); setUpFile(null); void refresh();
                  })}
                >上传</Button>
                {(!upFile || !upTitle) && (
                  <span className="text-sm text-muted-foreground">填写标题并选择文件后可上传</span>
                )}
              </div>
            </div>
            {upResult && (
              <div className="mt-2 rounded-md border border-stat-3-soft bg-stat-3-soft px-2.5 py-1.5 text-sm text-stat-3">
                {upResult}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead><TableHead>区域</TableHead>
            <TableHead>状态</TableHead><TableHead>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((a) => (
            <TableRow key={a.id} className="cursor-pointer" onClick={() => void run(async () => {
              const d = await getAsset(a.id);
              setDetail(d);
              setPubUrl(d.published_url ?? ""); // 换资产打开详情时重置发布链接输入，避免上一条资产的 URL 泄漏
              setIdTitle(""); setIdFile(null);  // 同理重置初始文稿表单
            })}>
              <TableCell>{a.title}</TableCell>
              <TableCell><Badge variant="outline">{ZONE_LABELS[a.zone]}</Badge></TableCell>
              <TableCell><StatusBadge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</StatusBadge></TableCell>
              <TableCell>{a.updated_at.slice(0, 10)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {assets.length === 0 && <EmptyState variant="list" size="sm" />}

      {detail && (
        <section ref={detailRef} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{detail.title}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{ZONE_LABELS[detail.zone]}</Badge>
                <StatusBadge tone={STATUS_TONES[detail.status]}>{STATUS_LABELS[detail.status]}</StatusBadge>
                <span>{detail.content_type}</span>
                {detail.source_url && <a className="text-primary hover:underline" href={detail.source_url}>源链接</a>}
                {detail.file_url && <a className="text-primary hover:underline" href={detail.file_url}>文件</a>}
              </div>
            </CardHeader>
            <CardContent>
              {/* nextStepHint：保留彩色提示条（效率优先，不引 Alert 组件） */}
              <div className="mb-2 rounded-md border border-stat-3-soft bg-stat-3-soft px-2.5 py-1.5 text-sm text-stat-3">
                <strong>下一步：</strong>{nextStepHint(detail)}
              </div>

              {/* 任务区：主任务唯一默认展开；无主任务/无可渲染表单则不显示 */}
              {task && taskNode && (
                <div className="mb-3 rounded-md border bg-muted/50 p-3">
                  <div className="mb-1.5 text-xs text-muted-foreground">当前任务</div>
                  {taskNode}
                </div>
              )}

              {(detail.content_type === "markdown" || detail.content_type === "docx") && detail.text_content && (
                <div className="mt-2">
                  <h3 className="text-sm font-semibold">生成正文</h3>
                  <pre className="mt-1 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                    {detail.text_content}
                  </pre>
                </div>
              )}

              <div className="mt-2">
                <h3 className="text-sm font-semibold">血缘</h3>
                <p className="text-sm">上游：{detail.upstream.map((d) => d.source_asset_id).join("、") || "无"}</p>
                <p className="text-sm">下游：{detail.downstream.map((d) => d.derived_asset_id).join("、") || "无"}</p>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer font-medium">
                  更多操作（手动状态流转 / 派生发布物 / 补链 / 删除）
                </summary>
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-1">
                    状态流转：
                    {(ZONE_TRANSITIONS[detail.zone]?.[detail.status] ?? []).map((s) => (
                      <Button key={s} size="sm" variant="outline" onClick={() => void run(async () => {
                        await patchStatus(detail.id, s);
                        setDetail(await getAsset(detail.id)); void refresh();
                      })}>{STATUS_LABELS[s]}</Button>
                    ))}
                  </div>

                  {detail.zone === "master" && (
                    <div className="mt-2">{renderDeriveForm(detail)}</div>
                  )}

                  {/* 图片母版已进入发布流程时，渲染封面不再是主任务，保留在此 */}
                  {detail.zone === "master" && detail.content_type === "image"
                    && task !== "master_image_finalized" && task !== "master_image_drafting" && (
                    <div className="mt-2">{renderCoverForm(detail, false)}</div>
                  )}

                  {/* 文本母版已进入发布流程时，文本变体保留在此 */}
                  {detail.zone === "master" && detail.text_content
                    && (detail.status === "publishing" || detail.status === "published") && (
                    <div className="mt-2">{renderTextVariantForm(detail)}</div>
                  )}

                  {/* 非「发布中」主任务的发布资产，登记/清除入口保留在此 */}
                  {detail.zone === "publish" && task !== "publish_publishing" && (
                    <div className="mt-2">{renderPublishRegForm(detail)}</div>
                  )}

                  {/* 已发布的文本发布物，语音包生成入口保留在此 */}
                  {detail.zone === "publish" && detail.content_type === "markdown"
                    && detail.text_content && task !== "publish_markdown" && (
                    <div className="mt-2">{renderVideoKitForm(detail)}</div>
                  )}

                  <div className="mt-2">
                    <h3 className="text-sm font-semibold">补链</h3>
                    <div className="mt-2 flex flex-col gap-2">
                      <Input placeholder="补链：上游资产 UUID" value={linkSource}
                             onChange={(e) => setLinkSource(e.target.value)} />
                      <div>
                        <Button onClick={() => void run(async () => {
                          await linkDerivation(detail.id, linkSource);
                          setLinkSource(""); setDetail(await getAsset(detail.id));
                        })}>补链</Button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <Button variant="destructive" onClick={() => void run(async () => {
                      await deleteAsset(detail.id); setDetail(null); void refresh();
                    })}>删除资产</Button>
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        </section>
      )}
    </main>
  );
}
