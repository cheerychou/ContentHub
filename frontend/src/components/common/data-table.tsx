import * as React from "react"
import type { HTMLAttributes } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/ui/error-state"
import { toErrorMessage } from "@/lib/normalize-error"
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

// （自 CDD3 shared-ui 移植，2026-09-10：cn 改 @/lib/utils；ErrorState 适配本仓 props；
//  去掉 density（本仓 Table 不支持）；duration-normal → duration-200）

export interface Column<T> {
  key: keyof T | string
  title: string
  render?: (item: T, index?: number) => React.ReactNode
  width?: string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
}

export interface DataTableProps<T extends object> {
  data: T[]
  columns: Column<T>[]
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  /** 错误（truthy 时在表格区渲染 ErrorState；兼容 Error 对象 / string） */
  error?: unknown
  /** 错误重试回调（通常接列表 refresh） */
  onRetry?: () => void
  className?: string

  // 分页相关（本仓列表为客户端一次性加载，可不传 onPageChange 隐藏分页条）
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (page: number) => void

  // 排序相关
  sortKey?: string
  sortOrder?: 'asc' | 'desc'
  onSort?: (key: string) => void

  // 行属性自定义（用于点击事件、选中样式等）
  getRowProps?: (item: T) => HTMLAttributes<HTMLTableRowElement>
  getRowKey?: (item: T, index: number) => React.Key
}

/** 骨架屏表格行数量 */
const SKELETON_ROWS = 5;

/**
 * 渲染骨架屏加载行
 */
function SkeletonRows({ columns }: { columns: Column<unknown>[] }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }).map((_, rowIdx) => (
        <TableRow key={`skeleton-${rowIdx}`}>
          {columns.map((col, colIdx) => (
            <TableCell
              key={`skeleton-${rowIdx}-${colIdx}`}
              className={col.width || ''}
              style={{ textAlign: col.align || 'left' }}
            >
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * 通用数据表格组件
 * 内置骨架屏加载状态、空状态和基础分页
 */
export function DataTable<T extends object = Record<string, unknown>>({
  data,
  columns,
  loading = false,
  emptyTitle = "暂无数据",
  emptyDescription = "没有找到相关记录",
  error,
  onRetry,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  className,
  sortKey,
  sortOrder,
  onSort,
  getRowProps,
  getRowKey,
}: DataTableProps<T>) {

  const totalPages = Math.ceil(total / pageSize)

  const hasError = !!error;
  const isEmpty = !loading && !hasError && data.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border overflow-hidden">
        <div className={cn(
          "transition-opacity duration-200",
          loading && data.length > 0 && "opacity-50 pointer-events-none"
        )}>
          <Table className={`table-fixed ${className || ''}`}>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={String(col.key)}
                    className={`${col.width || ''} ${col.sortable ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                    style={{ textAlign: col.align || 'left' }}
                    onClick={() => col.sortable && onSort?.(String(col.key))}
                  >
                    {col.title}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-xs text-muted-foreground ml-1">
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && data.length === 0 && (
                <SkeletonRows columns={columns as Column<unknown>[]} />
              )}
              {!loading && hasError && (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <ErrorState size="sm" error={toErrorMessage(error)} onRetry={onRetry} />
                  </TableCell>
                </TableRow>
              )}
              {!loading && isEmpty && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-48 text-center">
                    <div>
                      <p className="text-base font-medium">{emptyTitle}</p>
                      {emptyDescription && <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isEmpty && data.map((item, index) => (
                <TableRow
                  key={(() => {
                    if (getRowKey) return getRowKey(item, index)
                    const id = (item as unknown as { id?: unknown }).id
                    if (typeof id === 'string' || typeof id === 'number') return id
                    return index
                  })()}
                  {...(getRowProps ? getRowProps(item) : {})}
                >
                  {columns.map((col) => {
                    const cellContent = col.render
                      ? col.render(item, index)
                      : (() => {
                          const value = (item as unknown as Record<string, unknown>)[String(col.key)]
                          if (value === null || value === undefined) return ''
                          if (typeof value === 'bigint') return value.toString()
                          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
                          return ''
                        })()
                    return (
                      <TableCell
                        key={`${(() => {
                          if (getRowKey) return String(getRowKey(item, index))
                          const id = (item as unknown as { id?: unknown }).id
                          if (typeof id === 'string' || typeof id === 'number') return id
                          return String(index)
                        })()}-${String(col.key)}`}
                        className={col.width || ''}
                        style={{ textAlign: col.align || 'left' }}
                      >
                        {cellContent}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 简易分页条 */}
      {onPageChange && total > 0 && (
        <div className="flex items-center justify-end gap-2 py-4">
          <div className="text-sm text-muted-foreground">
            第 {page} 页 / 共 {totalPages} 页
          </div>
          <Button
            variant="outline"

            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            <CaretLeft className="h-4 w-4" />
            上一页
          </Button>
          <Button
            variant="outline"

            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            下一页
            <CaretRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
