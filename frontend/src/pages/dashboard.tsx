import { useCallback, useEffect, useState } from "react";
import { fetchMetaStats, listAssets, type MetaStats } from "../api";
import {
  STATUS_LABELS, STATUS_TONES, type Asset, type Status, type Zone,
} from "../types";
import { PageHeader } from "@/components/common/page-header";
import { Statistic } from "@/components/data-display/statistic";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Icons } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// 阶段页跳转表：驾驶舱各卡/漏斗/动态行点击直达对应阶段页（与 App.tsx 导航同 hash）
const STAGE_HASH: Record<Zone, string> = {
  source: "#/source", topic: "#/topic", master: "#/master", publish: "#/publish",
};

// 阶段页标题（与 App.tsx 导航/阶段页文案一致，数字旁标注看板口径）
const STAGE_LABEL: Record<Zone, string> = {
  source: "素材库", topic: "选题策划", master: "内容制作", publish: "内容发布",
};

// 漏斗四段条形色：同色相递减不透明度表达流程深度（只用语义 token，暗色自动生效）
const FUNNEL_BAR_TONES = ["bg-stat-6", "bg-stat-6/80", "bg-stat-6/60", "bg-stat-6/40"];

// 看板口径（全部由 GET /api/meta/stats 派生， zones 仅含计数 > 0 的状态）：
//   素材库 = source.total；选题（进行中）= topic candidate+researching；
//   内容制作（创作中）= master.drafting；已发布 = master.published + publish.published；
//   提示词与模板 = recipes。
export default function Dashboard() {
  const [stats, setStats] = useState<MetaStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [recent, setRecent] = useState<Asset[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(false);
  // 刷新：tick 变化触发重新拉取（PageHeader action）
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setStatsError(false); setRecentError(false);
    setRecentLoading(true);
    void fetchMetaStats()
      .then((s) => { setStats(s); })
      .catch(() => { setStats(null); setStatsError(true); });
    void listAssets({ limit: 10 }) // 后端按 updated_at desc 排序，取最近更新 10 条
      .then((a) => { setRecent(a); })
      .catch(() => { setRecent([]); setRecentError(true); })
      .finally(() => setRecentLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, tick]);

  // zones 字典取数助手：status 缺省取区总量；区/状态缺失按 0
  const n = (zone: Zone, status?: Status) =>
    stats ? (stats.zones[zone]?.[status ?? "total"] ?? 0) : 0;

  const statsLoading = !stats && !statsError;
  const topicInProgress = n("topic", "candidate") + n("topic", "researching");
  const published = n("master", "published") + n("publish", "published");

  const metricCards: { title: string; value: number | string; hash: string; nav: string }[] = [
    { title: "素材库", value: n("source"), hash: STAGE_HASH.source, nav: STAGE_LABEL.source },
    { title: "选题（候选+调研中）", value: topicInProgress, hash: STAGE_HASH.topic, nav: STAGE_LABEL.topic },
    { title: "内容制作（创作中）", value: n("master", "drafting"), hash: STAGE_HASH.master, nav: STAGE_LABEL.master },
    { title: "已发布", value: published, hash: STAGE_HASH.publish, nav: STAGE_LABEL.publish },
    { title: "提示词与模板", value: stats?.recipes ?? 0, hash: "#/recipes", nav: "提示词与模板" },
  ];

  // 流水线漏斗：四段存量（非流量）计数，宽度按四段最大值占比（纯 CSS）
  const funnel: { label: string; count: number; hash: string; nav: string }[] = [
    { label: "选题", count: n("topic"), hash: STAGE_HASH.topic, nav: STAGE_LABEL.topic },
    { label: "素材", count: n("source"), hash: STAGE_HASH.source, nav: STAGE_LABEL.source },
    { label: "制作", count: n("master", "drafting") + n("master", "finalized"), hash: STAGE_HASH.master, nav: STAGE_LABEL.master },
    { label: "发布", count: n("publish", "published"), hash: STAGE_HASH.publish, nav: STAGE_LABEL.publish },
  ];
  const max = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="数据驾驶舱"
        description="内容供应链全流程数据看板：关键指标、流水线漏斗与最近动态"
        action={
          <Button onClick={() => setTick((t) => t + 1)}>
            <Icons.Refresh size={16} />刷新
          </Button>
        }
      />

      {/* 指标卡网格：点击整卡跳对应阶段页 */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {metricCards.map((c) => (
          <Statistic
            key={c.title}
            title={c.title}
            value={statsError ? "—" : c.value}
            loading={statsLoading}
            role="link"
            tabIndex={0}
            aria-label={`${c.title}，前往${c.nav}页`}
            className="cursor-pointer gap-2 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => { location.hash = c.hash; }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { location.hash = c.hash; }
            }}
          />
        ))}
      </div>
      {statsError && (
        <p className="mt-2 text-sm text-destructive">
          指标加载失败，请点右上角「刷新」重试。
        </p>
      )}

      {/* 流水线漏斗：每段可点击跳对应阶段页 */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-muted-foreground">流水线漏斗</h2>
        <Card className="mt-2 gap-0 p-6">
          {statsLoading ? (
            <div className="flex flex-col gap-3">
              {funnel.map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <Skeleton className="h-5 w-10" />
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-5 w-10" />
                </div>
              ))}
            </div>
          ) : statsError ? (
            <p className="py-2 text-sm text-muted-foreground">数据不可用。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {funnel.map((f, i) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => { location.hash = f.hash; }}
                  title={`前往${f.nav}页`}
                  className="group flex items-center gap-3 rounded-md px-1 py-0.5 text-left hover:bg-muted/50"
                >
                  <span className="w-10 shrink-0 text-sm">{f.label}</span>
                  <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                    <span
                      className={cn("block h-full rounded-sm", FUNNEL_BAR_TONES[i])}
                      style={{ width: `${(f.count / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* 最近动态：最近更新 10 资产，行点击跳对应阶段页 */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-muted-foreground">最近动态</h2>
        <Card className="mt-2 gap-0 overflow-hidden p-0 py-2">
          {recentLoading ? (
            <div className="flex flex-col gap-3 px-6">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : recentError ? (
            <p className="px-6 py-2 text-sm text-muted-foreground">
              加载失败，请点右上角「刷新」重试。
            </p>
          ) : recent.length === 0 ? (
            <p className="px-6 py-2 text-sm text-muted-foreground">暂无资产。</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { location.hash = STAGE_HASH[a.zone]; }}
                    title={`前往${STAGE_LABEL[a.zone]}页`}
                    className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {a.title}
                    </span>
                    <StatusBadge tone={STATUS_TONES[a.status]}>
                      {STATUS_LABELS[a.status]}
                    </StatusBadge>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                      {STAGE_LABEL[a.zone]}
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {a.updated_at.slice(0, 10)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
