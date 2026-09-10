import * as React from 'react';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchForm, type SearchFormField } from '@/components/common/search-form';
import { SegmentTabsA } from '@/components/common/segment-tabs';
import { DataTable, type Column } from '@/components/common/data-table';
import { cn } from "@/lib/utils";
import { Skeleton } from '@/components/ui/skeleton';
import { toErrorMessage } from '@/lib/normalize-error';

// （自 CDD3 shared-ui 移植，2026-09-10：无 react-query/路由依赖可剥；
//  PageContainer → 本仓页面容器 div（flex flex-col gap-4 + className 透传）；
//  错误态适配：列表无数据时整块 ErrorState + 重试；已有数据时保留本仓行内错误条，
//  避免变更类操作（如上传失败）把整页替换成错误态——行内提示与重构前行为一致。）

export interface StandardListPageProps<T extends object> {
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;

  /**
   * 搜索字段配置。省略或传空数组时，整块搜索区（含查询/重置按钮）不渲染，
   * 用于无搜索需求的简单列表页。
   */
  searchFields?: SearchFormField[];
  searchValues?: Record<string, unknown>;
  onSearchChange?: (values: Record<string, unknown>) => void;
  onSearch?: () => void;
  onReset?: () => void;
  searchLoading?: boolean;

  statusFilter?: {
    options: { label: string; value: string }[];
    value: string;
    onChange: (value: string) => void;
  };

  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  error?: unknown;
  /** 错误重试回调（通常接列表 refresh）；不传则整页 reload */
  onRetry?: () => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;

  sortKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;

  onRowClick?: (item: T) => void;
  getRowKey?: (item: T, index: number) => string;

  headerContent?: React.ReactNode;
  className?: string;
}

/** 骨架屏行数量 */
const SKELETON_ROWS = 5;

/**
 * 列表页骨架屏占位
 */
function ListSkeleton() {
  return (
    <div data-testid="list-skeleton" className="rounded-md border p-6 space-y-4">
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: 5 }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StandardListPage<T extends object>({
  title,
  description,
  action,
  secondaryAction,
  searchFields,
  searchValues,
  onSearchChange,
  onSearch,
  onReset,
  searchLoading = false,
  statusFilter,
  data,
  columns,
  loading = false,
  error = null,
  onRetry,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  sortKey,
  sortOrder,
  onSort,
  onRowClick,
  getRowKey,
  headerContent,
  className,
}: StandardListPageProps<T>) {
  // data 归一化：上游初始值可能是 null/undefined，这里统一转 []
  const list = data ?? [];

  // 列表本身加载失败（无数据可展示）→ 整块错误态 + 重试
  if (error && list.length === 0) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <ErrorState size="sm" error={toErrorMessage(error)} onRetry={onRetry ?? (() => window.location.reload())} />
      </div>
    );
  }

  const renderView = () => {
    if (loading && list.length === 0) {
      return <ListSkeleton />;
    }

    if (list.length === 0) {
      return (
        <EmptyState
          title={`暂无${title}`}
          description="请尝试调整搜索条件或添加新数据"
        />
      );
    }

    return (
      <div className={cn(
        "transition-opacity duration-200",
        loading && "opacity-50 pointer-events-none"
      )}>
        <DataTable
          data={list}
          columns={columns}
          loading={loading}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={onPageChange}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSort={onSort}
          getRowProps={onRowClick ? (item) => ({ onClick: () => onRowClick(item), className: 'cursor-pointer' }) : undefined}
          getRowKey={getRowKey}
        />
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* 标题与说明同行左右结构（底部对齐） */}
      <div className="flex items-baseline gap-8 min-w-0">
        <h1 className="text-xl font-semibold shrink-0">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground truncate">{description}</p>
        )}
      </div>

      {searchFields && searchFields.length > 0 && (
        <Card className="flex flex-col p-4 gap-3">
          <SearchForm
            fields={searchFields}
            values={searchValues ?? {}}
            onChange={onSearchChange ?? (() => {})}
            onSearch={onSearch ?? (() => {})}
            onReset={onReset ?? (() => {})}
            layout="grid"
            loading={searchLoading}
          />
        </Card>
      )}

      {headerContent}

      {(action || statusFilter || secondaryAction) && (
        <div className="flex items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            {action}
            {statusFilter && (
              <SegmentTabsA
                items={statusFilter.options}
                value={statusFilter.value}
                onChange={statusFilter.onChange}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {secondaryAction}
          </div>
        </div>
      )}

      {/* 已有数据时的错误（多为变更类操作失败）→ 行内提示，不替换整页 */}
      {!!error && list.length > 0 && (
        <p className="text-sm text-destructive">{toErrorMessage(error)}</p>
      )}

      {renderView()}
    </div>
  );
}
