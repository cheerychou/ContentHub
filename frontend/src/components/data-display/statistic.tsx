/**
 * 统计数值卡（自 CDD3 shared-ui data-display/statistic 移植，2026-09-10，MIT）
 * 移植裁剪：trend / prefix / suffix / formatter / precision / valueStyle 未随迁
 * （驾驶舱暂无环比数据与单位前缀，需要时再从 CDD3 补齐）；保留 loading 骨架态。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface StatisticProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number | string;
  title?: string;
  loading?: boolean;
}

const Statistic = React.forwardRef<HTMLDivElement, StatisticProps>(
  ({ value, title, loading = false, className, ...props }, ref) => {
    return (
      <Card ref={ref} className={cn("p-6", className)} {...props}>
        {title && (
          <div className="mb-2 text-sm text-muted-foreground">{title}</div>
        )}
        <div className="flex flex-col gap-2">
          {loading ? (
            <div className="h-8 w-16 animate-pulse rounded bg-muted" />
          ) : (
            <div className="text-3xl font-bold tabular-nums">{String(value)}</div>
          )}
        </div>
      </Card>
    );
  }
);

Statistic.displayName = "Statistic";

export { Statistic };
