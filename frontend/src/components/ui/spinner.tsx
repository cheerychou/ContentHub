import { cn } from "@/lib/utils"
import { CircleNotchIcon } from '@phosphor-icons/react'

/**
 * Spinner 组件 - 用于按钮内的加载指示器
 * 配合 Button 使用时，添加 data-icon="inline-start" 属性可获得正确的间距
 */
export interface SpinnerProps extends React.ComponentProps<"svg"> {
  /** 无障碍标签 */
  label?: string
}

function Spinner({ className, label, ...props }: SpinnerProps) {
  return (
    <CircleNotchIcon
      role="status"
      aria-label={label || "Loading"}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
