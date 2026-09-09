import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Icons } from "@/components/ui/icons"
export type ErrorStateVariant = "default" | "network" | "server" | "permission" | "not-found"
export type ErrorStateSize = "sm" | "md" | "lg"

export interface ErrorStateProps {
  variant?: ErrorStateVariant
  size?: ErrorStateSize
  title?: string
  description?: string
  error?: Error | string | null
  actions?: Array<{
    label: string
    onClick: () => void
    variant?: "default" | "outline" | "ghost" | "destructive"
    icon?: React.ReactNode
  }>
  className?: string
  showRetry?: boolean
  onRetry?: () => void
}

const variantIcons: Record<ErrorStateVariant, React.ReactNode> = {
  default: <Icons.Warning className="h-12 w-12 text-destructive" />,
  network: <Icons.Error className="h-12 w-12 text-destructive" />,
  server: <Icons.Warning className="h-12 w-12 text-destructive" />,
  permission: <Icons.Error className="h-12 w-12 text-destructive" />,
  "not-found": <Icons.Warning className="h-12 w-12 text-muted-foreground" />,
}

const variantTitles: Record<ErrorStateVariant, string> = {
  default: "出错了",
  network: "网络连接失败",
  server: "服务器错误",
  permission: "权限不足",
  "not-found": "未找到",
}

const variantDescriptions: Record<ErrorStateVariant, string> = {
  default: "发生了一些问题，请稍后重试",
  network: "请检查您的网络连接后重试",
  server: "服务器暂时无法响应，请稍后重试",
  permission: "您没有权限访问此内容",
  "not-found": "您请求的资源不存在",
}

const sizeClasses: Record<ErrorStateSize, string> = {
  sm: "py-8 px-4",
  md: "py-12 px-6",
  lg: "py-16 px-8",
}

const iconSizeClasses: Record<ErrorStateSize, string> = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
}

const titleSizeClasses: Record<ErrorStateSize, string> = {
  sm: "text-sm font-medium",
  md: "text-base font-medium",
  lg: "text-lg font-medium",
}

const descriptionSizeClasses: Record<ErrorStateSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
}

export function ErrorState({
  variant = "default",
  size = "md",
  title,
  description,
  error,
  actions,
  className,
  showRetry = true,
  onRetry,
}: ErrorStateProps) {
  const displayIcon = variantIcons[variant]
  const displayTitle = title || variantTitles[variant]
  const displayDescription = description || variantDescriptions[variant]
  
  const errorMessage = error
    ? typeof error === "string"
      ? error
      : error.message || "未知错误"
    : null

  const defaultActions: Array<{
    label: string
    onClick: () => void
    variant?: "default" | "outline" | "ghost" | "destructive"
    icon?: React.ReactNode
  }> = []

  if (showRetry && onRetry) {
    defaultActions.push({
      label: "重试",
      onClick: onRetry,
      variant: "default",
      icon: <Icons.Refresh className="h-4 w-4" />,
    })
  }

  const allActions = actions || defaultActions

  return (
    <div className={cn("flex flex-col items-center justify-center text-center", sizeClasses[size], className)}>
      <div className={cn("mb-4 text-destructive", iconSizeClasses[size])}>
        {displayIcon}
      </div>
      <h3 className={cn("mb-2 text-foreground", titleSizeClasses[size])}>
        {displayTitle}
      </h3>
      {displayDescription && (
        <p className={cn("mb-4 max-w-md text-muted-foreground", descriptionSizeClasses[size])}>
          {displayDescription}
        </p>
      )}
      {errorMessage && (
        <p className="mb-6 max-w-md text-xs text-muted-foreground font-mono">
          {errorMessage}
        </p>
      )}
      {allActions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {allActions.map((action, index) => (
            <Button
              key={index}
              variant={action.variant || "default"}
              onClick={action.onClick}
              className="gap-2"
            >
              {action.icon as React.ReactNode}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ErrorStateSmall(props: Omit<ErrorStateProps, "size">) {
  return <ErrorState {...props} />
}

export function ErrorStateMedium(props: Omit<ErrorStateProps, "size">) {
  return <ErrorState {...props} size="md" />
}

export function ErrorStateLarge(props: Omit<ErrorStateProps, "size">) {
  return <ErrorState {...props} size="lg" />
}

export function NetworkError(props: Omit<ErrorStateProps, "variant">) {
  return <ErrorState {...props} variant="network" />
}

export function ServerError(props: Omit<ErrorStateProps, "variant">) {
  return <ErrorState {...props} variant="server" />
}

export function PermissionError(props: Omit<ErrorStateProps, "variant">) {
  return <ErrorState {...props} variant="permission" />
}

export function NotFoundError(props: Omit<ErrorStateProps, "variant">) {
  return <ErrorState {...props} variant="not-found" />
}
