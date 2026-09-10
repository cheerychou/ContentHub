import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  clearPublishInfo, deleteAsset, derive, deriveText, deriveVideoKit, getAsset,
  fetchMetaStats, fetchPlatformMeta, initialDraft, linkDerivation, listAssets,
  listRecipes, patchStatus, publishInfo, renderCover, uploadAsset,
  type MetaStats, type PlatformMeta,
} from "./api";
import {
  RECIPE_KIND_LABELS, STATUS_LABELS, ZONE_LABELS, ZONE_STATUSES,
  ZONE_TRANSITIONS, type Asset, type AssetDetail, type Recipe, type Status, type Zone,
} from "./types";
import Recipes from "./Recipes";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/common/page-header";
import { StandardListPage } from "@/components/common/standard-list-page";
import { type Column } from "@/components/common/data-table";
import {
  DetailPageLayout, DetailSection,
} from "@/components/common/detail-page-layout";
import { InfoField } from "@/components/common/info-field";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AppSidebar, type AppMenuItem } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/topbar";
import { AppFooter } from "@/components/ui/app-footer";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Icons } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// 四阶段工作台（M4）：导航即区域选择器；STAGES 同时驱动左导航与路由解析
const STAGES: { zone: Zone; hash: string; icon: string; label: string }[] = [
  { zone: "source", hash: "#/source", icon: "📚", label: "素材库" },
  { zone: "topic", hash: "#/topic", icon: "📝", label: "选题策划" },
  { zone: "master", hash: "#/master", icon: "🎬", label: "内容制作" },
  { zone: "publish", hash: "#/publish", icon: "📤", label: "内容发布" },
];

// 各阶段页文案（M6 Task 2）：StandardListPage 标题/一句话描述/主 action
// （publish 无上传 action——发布物靠派生，不提供手工新建入口）
const STAGE_PAGES: Record<Zone, { title: string; description: string; action?: string }> = {
  source: { title: "素材库", description: "原始素材与底片：内容生产的原料", action: "上传素材" },
  topic: { title: "选题策划", description: "候选、调研与立项：把想法变成可执行的题目", action: "新建选题" },
  master: { title: "内容制作", description: "母版创作与定稿：成品的单一可信来源", action: "上传母版" },
  publish: { title: "内容发布", description: "多平台发布登记与收口：内容到达读者的最后一公里" },
};

// 应用骨架导航（M6）：驾驶舱 + 四阶段 + 提示词与模板；countOf 从 /api/meta/stats 取徽标计数
const NAV: {
  key: string; label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  countOf?: (s: MetaStats) => number;
}[] = [
  { key: "#/dashboard", label: "驾驶舱", icon: Icons.ChartLine },
  { key: "#/source", label: "素材库", icon: Icons.Grid, countOf: (s) => s.zones.source?.total ?? 0 },
  { key: "#/topic", label: "选题策划", icon: Icons.Idea, countOf: (s) => s.zones.topic?.total ?? 0 },
  { key: "#/master", label: "内容制作", icon: Icons.Video, countOf: (s) => s.zones.master?.total ?? 0 },
  { key: "#/publish", label: "内容发布", icon: Icons.Send, countOf: (s) => s.zones.publish?.total ?? 0 },
  { key: "#/recipes", label: "提示词与模板", icon: Icons.Compose, countOf: (s) => s.recipes },
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

// 驾驶舱占位页（真实看板在 M6 任务 4 实现）
function DashboardPlaceholder() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="驾驶舱"
        description="内容供应链全流程数据看板 · 建设中（本迭代后续任务交付）"
      />
      <Card className="mt-4">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          资产总量、各区分布与产出趋势图表将在此呈现——数据接口
          GET /api/meta/stats 已就绪。
        </CardContent>
      </Card>
    </div>
  );
}

// 任务卡启动器（M6 Task 3）：表单 Dialog 化后，任务卡只保留一句话说明 + 打开按钮；
// 具体表单在对应 Dialog 内，提交逻辑逐字沿用原实现。
function TaskLauncher({ description, buttonText, onOpen }: {
  description: string;
  buttonText: string;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">{description}</p>
      <Button onClick={onOpen}>{buttonText}</Button>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  // #/ 重定向到 #/dashboard（默认进入驾驶舱，按 M6 信息架构）
  useEffect(() => {
    if (route === "" || route === "#" || route === "#/") location.replace("#/dashboard");
  }, [route]);

  // 折叠 state 顶层持有（SidebarProvider 受控），localStorage 记忆用户偏好
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ch-sidebar") === "collapsed"
  );
  useEffect(() => {
    localStorage.setItem("ch-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  // 统计徽标：挂载拉取一次；失败静默（徽标不显示，不阻塞导航）
  const [stats, setStats] = useState<MetaStats | null>(null);
  useEffect(() => {
    void fetchMetaStats().then(setStats).catch(() => setStats(null));
  }, []);

  const stage = STAGES.find((s) => route.startsWith(s.hash));
  const stageZone: Zone = stage?.zone ?? "source";

  const activeKey = NAV.find((n) => route.startsWith(n.key))?.key ?? "";
  const navItems: AppMenuItem[] = NAV.map((n) => ({
    key: n.key,
    label: n.label,
    icon: n.icon,
    count: stats && n.countOf ? n.countOf(stats) : undefined,
  }));
  const pageTitle = NAV.find((n) => n.key === activeKey)?.label;

  return (
    <SidebarProvider open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <div className="flex h-svh w-full overflow-hidden">
        <AppSidebar
          items={navItems}
          activeId={activeKey}
          onSelect={(key) => { if (key !== route) location.hash = key; }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar title={pageTitle} />
          <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            {route.startsWith("#/dashboard") ? (
              <DashboardPlaceholder />
            ) : route.startsWith("#/recipes") ? (
              <Recipes />
            ) : (
              <Assets key={stageZone} stageZone={stageZone} />
            )}
          </main>
          <AppFooter>ContentHub · 内容供应链工作台</AppFooter>
        </div>
      </div>
    </SidebarProvider>
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
  // 上传 Dialog 开合（M6 Task 2：表单搬入 Dialog；打开即重置，避免上次输入/结果残留）
  const [upOpen, setUpOpen] = useState(false);
  const openUploadDialog = () => {
    setUpTitle(""); setUpFile(null); setUpResult("");
    setUpOpen(true);
  };
  // 详情表单 Dialog 开合（M6 Task 3）：打开即重置该表单 state（同一规则，见各 open* 函数）；
  // 提交成功后关闭 Dialog——详情区已就地刷新，与上传 Dialog「留驻展示入库结果」不同。
  // 渲染封面
  const [rcOpen, setRcOpen] = useState(false);
  const openRcDialog = () => {
    // 平台默认取 meta 首个合法封面平台（历史默认「微信公众号」不在 cover 词表，
    // 直接提交会被后端 422 拒绝）；meta 不可用时退回历史默认。
    setRcPlatform(coverPlatforms[0] ?? "微信公众号");
    setRcRecipeId(""); setRcTitle(""); setRcSubtitle(""); setRcSpec("");
    setRcOpen(true);
  };
  // 文本变体
  const [dtOpen, setDtOpen] = useState(false);
  const openDtDialog = () => {
    setDtRecipeId(""); setDtTitle(""); setDtInstructions("");
    setDtOpen(true);
  };
  // 视频语音包
  const [vkOpen, setVkOpen] = useState(false);
  const openVkDialog = () => {
    setVkVoice("晓晓（女）"); setVkTitle("");
    setVkOpen(true);
  };
  // 发布登记
  const [pubOpen, setPubOpen] = useState(false);
  const openPubDialog = () => {
    setPubUrl(detail?.published_url ?? ""); // 与旧行为一致：以已登记链接为初值（可改写覆盖）
    setPubOpen(true);
  };
  // 产出初始文稿
  const [idOpen, setIdOpen] = useState(false);
  const openIdDialog = () => {
    setIdTitle(""); setIdFile(null);
    setIdOpen(true);
  };
  // 派生表单（低频，按 Dialog 分层决策保留在「更多操作」内联）
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
  const stagePage = STAGE_PAGES[stageZone];

  // 表格列（M6 Task 2）：标题（text-sm font-medium + 文件名/类型辅助行）、状态、更新时间
  const columns: Column<Asset>[] = [
    {
      key: "title", title: "标题",
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{a.title}</p>
          <p className="truncate text-xs text-muted-foreground">{a.file_name ?? a.content_type}</p>
        </div>
      ),
    },
    {
      key: "status", title: "状态",
      render: (a) => (
        <StatusBadge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</StatusBadge>
      ),
    },
    { key: "updated_at", title: "更新时间", render: (a) => a.updated_at.slice(0, 10) },
  ];

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

  // —— 渲染封面/文本变体/语音包/发布登记/产出初始文稿表单（M6 Task 3）：——
  // 表单整体搬入对应 Dialog（见下方 JSX），字段与提交逻辑逐字沿用；
  // 仅两处差异：① 提交成功后关闭 Dialog（详情就地刷新，无需留驻）；
  // ② 打开时重置表单 state（open* 函数）。
  // 派生发布物与补链为低频操作，按 Dialog 分层决策保留在「更多操作」内联。

  // 任务区：按 primaryTask 渲染唯一展开的主任务
  // （M6 Task 3：带表单的任务改为 TaskLauncher 一句话说明 + 打开 Dialog；
  //   单击类任务（定稿/阶段推进）保留原内联按钮，提交逻辑逐字不变。）
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
        return d.text_content ? (
          <TaskLauncher
            description="选择提示词，生成本篇的口播稿/公众号版/GEO 变体"
            buttonText="打开「文本变体」"
            onOpen={openDtDialog}
          />
        ) : null;
      case "master_image_finalized":
        return (
          <TaskLauncher
            description="选择封面模板与平台（如 抖音·竖版），渲染本篇封面"
            buttonText="打开「渲染封面」"
            onOpen={openRcDialog}
          />
        );
      case "master_image_drafting":
        return ( // 未定稿：Dialog 内先提示
          <TaskLauncher
            description="选择封面模板与平台渲染封面（Dialog 内会提示先定稿）"
            buttonText="打开「渲染封面」"
            onOpen={openRcDialog}
          />
        );
      case "publish_markdown":
        return d.text_content ? (
          <TaskLauncher
            description="生成音频 + SRT 字幕 + 素材清单三件套语音包"
            buttonText="打开「生成视频语音包」"
            onOpen={openVkDialog}
          />
        ) : null;
      case "publish_publishing":
        return (
          <TaskLauncher
            description="发布完成后填入平台链接完成登记"
            buttonText="打开「发布登记」"
            onOpen={openPubDialog}
          />
        );
      case "video_kit":
        // 下载 CTA 移至详情头部 actions（M6 Task 3）；此处保留语音包元信息
        return (
          <div>
            <h3 className="text-sm font-semibold">视频语音包</h3>
            <p className="my-1 text-sm">
              音色：{typeof d.meta.voice === "string" ? d.meta.voice : "—"}
              {typeof d.meta.sentences === "number"
                && <> · 分句 {d.meta.sentences} 句</>}
            </p>
            <p className="text-sm text-muted-foreground">
              下载入口在详情头部（zip：音频 + SRT 字幕 + 素材清单）
            </p>
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
        if (d.status === "approved") {
          return (
            <TaskLauncher
              description="上传 md/docx 文稿，落成素材库文件并记录与本选题的血缘"
              buttonText="打开「产出初始文稿」"
              onOpen={openIdDialog}
            />
          );
        }
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
    <div className="mx-auto max-w-[1100px]">
      {/* 列表页原型（M6 Task 2）：标题/描述/搜索/主 action + SegmentTabs 状态筛选 + 表格 */}
      <StandardListPage<Asset>
        title={stagePage.title}
        description={stagePage.description}
        action={stagePage.action
          ? <Button onClick={openUploadDialog}>{stagePage.action}</Button>
          : undefined}
        searchFields={[{ name: "q", label: "关键词", type: "input", placeholder: "搜索标题/正文…" }]}
        searchValues={{ q }}
        onSearchChange={(v) => setQ(String(v.q ?? ""))}
        onSearch={() => void refresh()}
        onReset={() => setQ("")}
        statusFilter={{ options: statusFilters, value: status, onChange: setStatus }}
        data={assets}
        columns={columns}
        error={error}
        onRetry={() => void refresh()}
        onRowClick={(a) => void run(async () => {
          const d = await getAsset(a.id);
          setDetail(d);
          setPubUrl(d.published_url ?? ""); // 换资产打开详情时重置发布链接输入，避免上一条资产的 URL 泄漏
          setIdTitle(""); setIdFile(null);  // 同理重置初始文稿表单
        })}
        getRowKey={(a) => a.id}
      />

      {/* 上传 Dialog（M6 Task 2）：表单原逻辑搬入；提交成功留在弹窗内展示入库结果 */}
      {stageZone !== "publish" && (
        <Dialog open={upOpen} onOpenChange={setUpOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {stagePage.action}（入库到{stageInfo?.label ?? ZONE_LABELS[stageZone]}）
              </DialogTitle>
              <DialogDescription>
                上传目标即当前阶段区；入库后点击列表任意一行打开详情。
              </DialogDescription>
            </DialogHeader>
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
              {upResult && (
                <div className="mt-2 rounded-md border border-stat-3-soft bg-stat-3-soft px-2.5 py-1.5 text-sm text-stat-3">
                  {upResult}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 资产详情（M6 Task 3）：DetailPageLayout 原型——详情回归浏览态，
          带表单的任务经 Dialog 承载；onBack 关闭详情回到列表浏览态 */}
      {detail && (
        <>
          <section ref={detailRef} className="mt-4">
            <DetailPageLayout
              breadcrumbItems={[stagePage.title, detail.title]}
              title={detail.title}
              subtitle={`${ZONE_LABELS[detail.zone]}·${detail.content_type}`}
              statusBadge={{ text: STATUS_LABELS[detail.status], tone: STATUS_TONES[detail.status] }}
              onBack={() => setDetail(null)}
              headerRightContent={task === "video_kit" && detail.file_url ? (
                // video_kit 下载 CTA：主任务为语音包时置于头部 actions（primary 样式）
                <a href={detail.file_url} download
                   className={cn(buttonVariants())}>
                  下载语音包（zip：音频 + SRT 字幕 + 素材清单）
                </a>
              ) : undefined}
            >
              {/* 基本信息 */}
              <DetailSection title="基本信息" columns={3}>
                <InfoField label="区域" value={ZONE_LABELS[detail.zone]} />
                <InfoField label="状态" type="badge" value={STATUS_LABELS[detail.status]}
                           statusTone={STATUS_TONES[detail.status]} />
                <InfoField label="类型" value={detail.content_type} />
                <InfoField label="创建人" value={detail.created_by} />
                <InfoField label="创建时间" type="datetime" value={detail.created_at} />
                <InfoField label="更新时间" type="datetime" value={detail.updated_at} />
                {detail.source_url && (
                  <InfoField label="来源链接" type="custom" className="min-w-0"
                             value={<a className="text-primary hover:underline break-all"
                                       href={detail.source_url}>{detail.source_url}</a>} />
                )}
                {detail.file_url && (
                  <InfoField label="文件" type="custom"
                             value={<a className="text-primary hover:underline"
                                       href={detail.file_url}>下载文件</a>} />
                )}
                {detail.published_url && (
                  <InfoField label="发布链接" type="custom" className="min-w-0"
                             value={<a className="text-primary hover:underline break-all"
                                       href={detail.published_url}>{detail.published_url}</a>} />
                )}
              </DetailSection>

              {/* 当前任务：nextStepHint + 主任务（表单类任务 = TaskLauncher 打开 Dialog） */}
              <DetailSection title="当前任务" columns={2}>
                <div className="md:col-span-2 flex flex-col gap-2">
                  {/* nextStepHint：保留彩色提示条（效率优先，不引 Alert 组件） */}
                  <div className="rounded-md border border-stat-3-soft bg-stat-3-soft px-2.5 py-1.5 text-sm text-stat-3">
                    <strong>下一步：</strong>{nextStepHint(detail)}
                  </div>
                  {/* 主任务唯一默认展开；无主任务/无可渲染表单则不显示 */}
                  {task && taskNode && (
                    <div className="rounded-md border bg-muted/50 p-3">
                      {taskNode}
                    </div>
                  )}
                </div>
              </DetailSection>

              {/* 正文（markdown/docx 有文本时展示） */}
              {(detail.content_type === "markdown" || detail.content_type === "docx") && detail.text_content && (
                <DetailSection title="正文" columns={2}>
                  <div className="md:col-span-2">
                    <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                      {detail.text_content}
                    </pre>
                  </div>
                </DetailSection>
              )}

              {/* 血缘（补链在「更多操作」） */}
              <DetailSection title="血缘" columns={2}>
                <InfoField label="上游"
                           value={detail.upstream.map((d) => d.source_asset_id).join("、") || "无"} />
                <InfoField label="下游"
                           value={detail.downstream.map((d) => d.derived_asset_id).join("、") || "无"} />
              </DetailSection>

              {/* 更多操作：低频/危险操作收口（手动流转/派生发布物/补链/删除 +
                  非主任务期的 Dialog 入口） */}
              <details>
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

                  {/* 图片母版已进入发布流程时，渲染封面不再是主任务，入口保留在此（打开 Dialog） */}
                  {detail.zone === "master" && detail.content_type === "image"
                    && task !== "master_image_finalized" && task !== "master_image_drafting" && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">渲染封面：</span>
                      <Button size="sm" variant="outline" onClick={openRcDialog}>打开</Button>
                    </div>
                  )}

                  {/* 文本母版已进入发布流程时，文本变体入口保留在此（打开 Dialog） */}
                  {detail.zone === "master" && detail.text_content
                    && (detail.status === "publishing" || detail.status === "published") && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">文本变体：</span>
                      <Button size="sm" variant="outline" onClick={openDtDialog}>打开</Button>
                    </div>
                  )}

                  {/* 非「发布中」主任务的发布资产，登记/清除入口保留在此（打开 Dialog） */}
                  {detail.zone === "publish" && task !== "publish_publishing" && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">发布登记：</span>
                      <Button size="sm" variant="outline" onClick={openPubDialog}>打开</Button>
                    </div>
                  )}

                  {/* 已发布的文本发布物，语音包生成入口保留在此（打开 Dialog） */}
                  {detail.zone === "publish" && detail.content_type === "markdown"
                    && detail.text_content && task !== "publish_markdown" && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">生成视频语音包：</span>
                      <Button size="sm" variant="outline" onClick={openVkDialog}>打开</Button>
                    </div>
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
            </DetailPageLayout>
          </section>

          {/* 渲染封面 Dialog：字段与提交逻辑逐字沿用原 renderCoverForm */}
          <Dialog open={rcOpen} onOpenChange={setRcOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>渲染封面</DialogTitle>
                <DialogDescription>按平台渲染封面图，产出图片发布物并入本母版血缘。</DialogDescription>
              </DialogHeader>
              {/* 未定稿提示（原 showDraftNote：仅创作中状态出现） */}
              {(detail.status === "topic" || detail.status === "drafting") && (
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
                {/* items：让 SelectValue（触发器）按 label 显示，而非原始 value（UUID/空串） */}
                <Select value={rcRecipeId} onValueChange={(v) => setRcRecipeId(v as string)}
                        items={[{ value: "", label: "选择封面模板…" },
                                ...coverRecipes.map((r) => ({ value: r.id, label: r.name }))]}>
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
                  await renderCover(detail.id, rcRecipeId, rcPlatform, rcTitle,
                    rcSubtitle || undefined, spec);
                  setRcTitle(""); setRcSubtitle(""); setRcSpec("");
                  setDetail(await getAsset(detail.id)); void refresh();
                  setRcOpen(false); // 提交成功关闭：详情已就地刷新
                })}>渲染</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* 文本变体 Dialog：字段与提交逻辑逐字沿用原 renderTextVariantForm */}
          <Dialog open={dtOpen} onOpenChange={setDtOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>文本变体</DialogTitle>
                <DialogDescription>按提示词生成本篇的口播稿/公众号版/GEO 变体。</DialogDescription>
              </DialogHeader>
              <div className="mt-2 flex flex-col gap-2">
                {/* items：触发器显示模板名（含类型），而非原始 value（UUID/空串） */}
                <Select value={dtRecipeId} onValueChange={(v) => setDtRecipeId(v as string)}
                        items={[{ value: "", label: "选择提示词…" },
                                ...textRecipes.map((r) => ({
                                  value: r.id,
                                  label: `${r.name}（${RECIPE_KIND_LABELS[r.kind]}）`,
                                }))]}>
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
                  await deriveText(detail.id, dtRecipeId, dtTitle, dtInstructions || undefined);
                  setDtTitle(""); setDtInstructions("");
                  setDetail(await getAsset(detail.id)); void refresh();
                  setDtOpen(false);
                })}>生成变体</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* 生成视频语音包 Dialog：字段与提交逻辑逐字沿用原 renderVideoKitForm */}
          <Dialog open={vkOpen} onOpenChange={setVkOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>生成视频语音包</DialogTitle>
                <DialogDescription>生成音频 + SRT 字幕 + 素材清单三件套。</DialogDescription>
              </DialogHeader>
              <div className="mt-2 flex flex-col gap-2">
                {/* items：音色展示名即 value（labels==values），显式声明保证触发器稳定解析 */}
                <Select value={vkVoice} onValueChange={(v) => setVkVoice(v as string)}
                        items={voiceOptions.map((v) => ({ value: v, label: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {voiceOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="语音包标题（可选）" value={vkTitle}
                       onChange={(e) => setVkTitle(e.target.value)} />
                <Button onClick={() => void run(async () => {
                  await deriveVideoKit(detail.id, vkVoice, vkTitle || undefined);
                  setVkTitle("");
                  setDetail(await getAsset(detail.id)); void refresh();
                  setVkOpen(false);
                })}>生成语音包</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* 发布登记 Dialog：字段与提交逻辑逐字沿用原 renderPublishRegForm */}
          <Dialog open={pubOpen} onOpenChange={setPubOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>发布登记</DialogTitle>
                <DialogDescription>正式发布后回填平台链接；登记后可点「已发布」收口。</DialogDescription>
              </DialogHeader>
              {detail.published_url ? (
                <p className="my-1 text-sm">
                  已登记：<a className="text-primary hover:underline" href={detail.published_url}>{detail.published_url}</a>
                  {detail.published_at && <>（{detail.published_at.slice(0, 10)}）</>}
                </p>
              ) : <p className="my-1 text-sm">未登记发布链接</p>}
              {typeof detail.meta?.platform === "string"
                && entryUrls[detail.meta.platform.split("·")[0]] && (
                <p className="my-1 text-sm">
                  <a className="text-primary hover:underline"
                     href={entryUrls[detail.meta.platform.split("·")[0]]}
                     target="_blank" rel="noreferrer">
                    打开平台上传页（{detail.meta.platform}）
                  </a>
                </p>
              )}
              <div className="mt-2 flex flex-col gap-2">
                <Input placeholder="https://… 发布链接" value={pubUrl}
                       onChange={(e) => setPubUrl(e.target.value)} />
                <div className="flex items-center gap-2">
                  <Button onClick={() => void run(async () => {
                    if (!pubUrl) return;
                    await publishInfo(detail.id, pubUrl);
                    setDetail(await getAsset(detail.id)); void refresh();
                    setPubOpen(false);
                  })}>登记</Button>
                  {detail.published_url && (
                    <Button variant="outline" onClick={() => void run(async () => {
                      await clearPublishInfo(detail.id);
                      setPubUrl(""); setDetail(await getAsset(detail.id)); void refresh();
                      setPubOpen(false);
                    })}>清除</Button>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* 产出初始文稿 Dialog：字段与提交逻辑逐字沿用原 renderInitialDraftForm
              （已立项选题 → 源料区 available 文稿，后端记 topic→source 血缘） */}
          <Dialog open={idOpen} onOpenChange={setIdOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>产出初始文稿</DialogTitle>
                <DialogDescription>文稿将入素材库并记录与本选题的血缘。</DialogDescription>
              </DialogHeader>
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
                    await initialDraft(detail.id, idTitle, idFile);
                    setIdTitle(""); setIdFile(null);
                    setDetail(await getAsset(detail.id)); void refresh();
                    setIdOpen(false);
                  })}
                >产出文稿</Button>
                <p className="mt-0 text-sm text-muted-foreground">
                  文稿将入素材库并记录与本选题的血缘
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
