/**
 * 状态标签组件
 *
 * 用于展示对象的业务状态，如订单状态、任务状态等。
 * 基于 Badge 原子组件构建，使用语义化 CSS 变量。
 *
 * @param tone - 状态语义级别
 * @param children - 展示文案
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'default';

export interface StatusBadgeProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

const toneClassMap: Record<StatusTone, string> = {
  success: 'bg-stat-3-soft text-stat-3 border border-stat-3-soft',
  warning: 'bg-warning-soft text-warning border border-warning-soft',
  danger: 'bg-destructive-soft text-destructive border border-destructive-soft',
  info: 'bg-stat-6-soft text-stat-6 border border-stat-6-soft',
  default: 'bg-muted text-muted-foreground border border-muted-foreground/20',
};

function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('px-2 py-0.5 h-5 text-xs font-medium rounded-full', toneClassMap[tone], className)}
    >
      {children}
    </Badge>
  );
}

export { StatusBadge };
