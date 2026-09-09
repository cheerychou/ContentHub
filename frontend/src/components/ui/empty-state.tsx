import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Icons } from "@/components/ui/icons"
import { Tray } from '@phosphor-icons/react';
export type EmptyStateVariant = "default" | "search" | "list" | "error" | "info"
export type EmptyStateSize = "sm" | "md" | "lg"

export interface EmptyStateProps {
  variant?: EmptyStateVariant
  size?: EmptyStateSize
  icon?: React.ReactNode
  title?: string
  description?: string
  action?: {
    label: string
    onClick: () => void
    variant?: "default" | "outline" | "ghost" | "destructive"
  }
  className?: string
}

const variantIcons: Record<EmptyStateVariant, React.ReactNode> = {
  default: <Tray className="h-12 w-12 text-muted-foreground" />,
  search: <Icons.Search className="h-12 w-12 text-muted-foreground" />,
  list: <Icons.Document className="h-12 w-12 text-muted-foreground" />,
  error: <Icons.Warning className="h-12 w-12 text-destructive" />,
  info: <Icons.Info className="h-12 w-12 text-muted-foreground" />,
}

const variantTitles: Record<EmptyStateVariant, string> = {
  default: "暂无数据",
  search: "未找到相关结果",
  list: "列表为空",
  error: "出错了",
  info: "提示信息",
}

const variantDescriptions: Record<EmptyStateVariant, string> = {
  default: "当前没有可显示的数据",
  search: "请尝试使用其他关键词搜索",
  list: "当前列表中没有数据",
  error: "加载失败，请稍后重试",
  info: "暂无相关信息",
}

const sizeClasses: Record<EmptyStateSize, string> = {
  sm: "py-8 px-4",
  md: "py-12 px-6",
  lg: "py-16 px-8",
}

const iconSizeClasses: Record<EmptyStateSize, string> = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
}

const titleSizeClasses: Record<EmptyStateSize, string> = {
  sm: "text-sm font-medium",
  md: "text-base font-medium",
  lg: "text-lg font-medium",
}

const descriptionSizeClasses: Record<EmptyStateSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
}

export function EmptyState({
  variant = "default",
  size = "md",
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const displayIcon = icon || variantIcons[variant]
  const displayTitle = title || variantTitles[variant]
  const displayDescription = description || variantDescriptions[variant]

  return (
    <div className={cn("flex flex-col items-center justify-center text-center", sizeClasses[size], className)}>
      <div className={cn("mb-4 text-muted-foreground", iconSizeClasses[size])}>
        {displayIcon}
      </div>
      <h3 className={cn("mb-2 text-foreground", titleSizeClasses[size])}>
        {displayTitle}
      </h3>
      {displayDescription && (
        <p className={cn("mb-6 max-w-md text-muted-foreground", descriptionSizeClasses[size])}>
          {displayDescription}
        </p>
      )}
      {action && (
        <Button variant={action.variant || "default"} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

export function EmptyStateSmall(props: Omit<EmptyStateProps, "size">) {
  return <EmptyState {...props} />
}

export function EmptyStateMedium(props: Omit<EmptyStateProps, "size">) {
  return <EmptyState {...props} size="md" />
}

export function EmptyStateLarge(props: Omit<EmptyStateProps, "size">) {
  return <EmptyState {...props} size="lg" />
}
