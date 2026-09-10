import * as React from 'react';
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import type { StatusTone } from '@/components/ui/status-badge';

// （自 CDD3 shared-ui 移植，2026-09-10：无路由/react-query 依赖可剥，仅改 import 路径。）

export interface InfoFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value?: React.ReactNode;
  type?: 'text' | 'datetime' | 'date' | 'number' | 'currency' | 'badge' | 'custom';
  format?: (value: unknown) => string;
  emptyText?: string;
  labelClassName?: string;
  valueClassName?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  statusTone?: StatusTone;
  copyable?: boolean;
}

/**
 * 统一的信息字段展示组件
 * 用于详情页中展示标签-值对
 */
export function InfoField({
  label,
  value,
  type = 'text',
  format,
  emptyText = '-',
  labelClassName,
  valueClassName,
  badgeVariant = 'default',
  statusTone,
  copyable = false,
  className,
  ...props
}: InfoFieldProps) {
  const renderValue = () => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-muted-foreground">{emptyText}</span>;
    }

    if (format) {
      return <span>{format(value)}</span>;
    }

    switch (type) {
      case 'datetime': {
        const dateValue = value instanceof Date ? value : new Date(value as string);
        if (isNaN(dateValue.getTime())) {
          return <span className="text-muted-foreground">{emptyText}</span>;
        }
        return <span>{dateValue.toLocaleString('zh-CN')}</span>;
      }

      case 'date': {
        const dateOnly = value instanceof Date ? value : new Date(value as string);
        if (isNaN(dateOnly.getTime())) {
          return <span className="text-muted-foreground">{emptyText}</span>;
        }
        return <span>{dateOnly.toLocaleDateString('zh-CN')}</span>;
      }

      case 'number': {
        const numValue = typeof value === 'number' ? value : parseFloat(value as string);
        if (isNaN(numValue)) {
          return <span className="text-muted-foreground">{emptyText}</span>;
        }
        return <span>{numValue.toLocaleString('zh-CN')}</span>;
      }

      case 'currency': {
        const currencyValue = typeof value === 'number' ? value : parseFloat(value as string);
        if (isNaN(currencyValue)) {
          return <span className="text-muted-foreground">{emptyText}</span>;
        }
        return <span>¥{currencyValue.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>;
      }

      case 'badge':
        if (statusTone) {
          return <StatusBadge tone={statusTone}>{String(value)}</StatusBadge>;
        }
        return <Badge variant={badgeVariant}>{String(value)}</Badge>;

      case 'custom':
        return <>{value}</>;

      default:
        return <span>{String(value)}</span>;
    }
  };

  const handleCopy = async () => {
    if (copyable && value) {
      try {
        await navigator.clipboard.writeText(String(value));
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
  };

  return (
    <div className={cn('flex flex-col gap-1', className)} {...props}>
      <label className={cn('text-xs text-muted-foreground', labelClassName)}>
        {label}
      </label>
      <div
        className={cn(
          'text-sm font-medium',
          copyable && 'cursor-pointer hover:text-primary transition-colors',
          valueClassName
        )}
        onClick={copyable ? handleCopy : undefined}
        title={copyable ? '点击复制' : undefined}
      >
        {renderValue()}
      </div>
    </div>
  );
}

export interface InfoFieldGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4;
  children: React.ReactNode;
}

/**
 * 信息字段组组件
 * 用于统一布局多个 InfoField
 */
export function InfoFieldGroup({
  columns = 4,
  children,
  className,
  ...props
}: InfoFieldGroupProps) {
  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
  };

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        gridCols[columns],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
