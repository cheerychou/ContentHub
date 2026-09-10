import * as React from 'react';
import { ArrowLeft, Printer } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SimpleBreadcrumb, type BreadcrumbItemData } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import type { StatusTone } from '@/components/ui/status-badge';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { toErrorMessage } from '@/lib/normalize-error';

// （自 CDD3 shared-ui 移植，2026-09-10：按计划剥离 react-router——
//  DetailPageAction.asLink/to 与 <Link> 渲染分支移除，动作仅保留 Button；
//  PageContainer → 本仓页面容器 div（flex flex-col gap-4 + className 透传）；
//  PageBreadcrumb（依赖 router Link）→ 本仓 SimpleBreadcrumb（href 仅展示不路由）；
//  ErrorState 适配本仓签名（message → error prop）。
//  本仓新增：onBack 在正常态标题左侧渲染返回图标按钮（详情回归浏览态的关闭入口），
//  与 PageHeader 的 onBack 约定一致；空态仍保留「返回列表」按钮。）

export interface DetailPageAction {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  visible?: boolean;
}

export interface DetailPageLayoutProps {
  breadcrumbItems: string[];
  title: string;
  subtitle?: string;
  statusBadge?: {
    text: string;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
    tone?: StatusTone;
  };
  actions?: DetailPageAction[];
  onPrint?: () => void;
  printLoading?: boolean;
  onBack?: () => void;
  loading?: boolean;
  loadingText?: string;
  /** 错误（truthy 时渲染 ErrorState；兼容 Error 对象 / string / null，内部 normalize） */
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  children: React.ReactNode;
  className?: string;
  headerRightContent?: React.ReactNode;
}

/**
 * 将字符串数组转换为面包屑项数组
 */
function toBreadcrumbItems(items: string[]): BreadcrumbItemData[] {
  return items.map((label, index) => ({
    label,
    href: index === items.length - 1 ? undefined : '#',
  }));
}

/**
 * 详情页布局组件
 * 统一详情页的面包屑、标题、操作按钮、加载/错误/空状态处理
 */
export function DetailPageLayout({
  breadcrumbItems,
  title,
  subtitle,
  statusBadge,
  actions = [],
  onPrint,
  printLoading = false,
  onBack,
  loading = false,
  loadingText = '加载中...',
  error,
  onRetry,
  empty = false,
  emptyTitle = '未找到数据',
  emptyDescription = '该数据可能不存在或已被删除',
  children,
  className,
  headerRightContent,
}: DetailPageLayoutProps) {
  if (loading) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <SimpleBreadcrumb
          items={toBreadcrumbItems(breadcrumbItems)}
          className="text-muted-foreground opacity-30 -mt-2"
        />
        <div className="flex flex-col items-center justify-center h-[400px]">
          <Spinner className="size-8" label={loadingText} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <SimpleBreadcrumb
          items={toBreadcrumbItems(breadcrumbItems)}
          className="text-muted-foreground opacity-30 -mt-2"
        />
        <div className="flex flex-col items-center justify-center h-[400px]">
          <ErrorState error={toErrorMessage(error)} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <SimpleBreadcrumb
          items={toBreadcrumbItems(breadcrumbItems)}
          className="text-muted-foreground opacity-30 -mt-2"
        />
        <div className="flex flex-col items-center justify-center h-[400px]">
          <EmptyState title={emptyTitle} description={emptyDescription} />
          {onBack && (
            <Button variant="outline" onClick={onBack} className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回列表
            </Button>
          )}
        </div>
      </div>
    );
  }

  const visibleActions = actions.filter((action) => action.visible !== false);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <SimpleBreadcrumb
        items={toBreadcrumbItems(breadcrumbItems)}
        className="text-muted-foreground opacity-30 -mt-2"
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="返回列表"
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-xl font-semibold truncate">{title}</h1>
          {subtitle && (
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          )}
          {statusBadge && (
            statusBadge.tone ? (
              <StatusBadge tone={statusBadge.tone}>{statusBadge.text}</StatusBadge>
            ) : (
              <Badge variant={statusBadge.variant || 'default'}>{statusBadge.text}</Badge>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          {headerRightContent}
          {onPrint && (
            <Button variant="outline" onClick={onPrint} disabled={printLoading}>
              <Printer className="w-4 h-4 mr-2" />
              {printLoading ? '打印中...' : '打印'}
            </Button>
          )}
          {visibleActions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.key}
                variant={action.variant || 'outline'}
                onClick={action.onClick}
                disabled={action.disabled || action.loading}
              >
                {Icon && <Icon className="w-4 h-4 mr-2" />}
                {action.loading ? '处理中...' : action.label}
              </Button>
            );
          })}
        </div>
      </div>

      {children}
    </div>
  );
}

export interface DetailSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  columns?: 2 | 3 | 4;
}

/**
 * 详情页区块组件
 * 用于组织详情页中的各个信息区块
 */
export function DetailSection({
  title,
  icon: Icon,
  action,
  columns = 4,
  children,
  className,
  ...props
}: DetailSectionProps) {
  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  };

  return (
    <div className={cn('flex flex-col p-4 gap-3 border rounded-lg', className)} {...props}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          {title}
        </h2>
        {action}
      </div>
      <div className={cn('grid grid-cols-1 gap-4 text-sm', gridCols[columns])}>
        {children}
      </div>
    </div>
  );
}
