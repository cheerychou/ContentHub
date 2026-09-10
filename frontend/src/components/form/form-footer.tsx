import * as React from "react"
import { cn } from "@/lib/utils"

// （自 CDD3 shared-ui form/form-footer 移植，2026-09-10：无路由/外部依赖可剥，仅改 import 路径。）

export interface FormFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 左对齐内容（如取消、返回按钮） */
  left?: React.ReactNode
  /** 右对齐内容（如提交按钮），默认居右 */
  children?: React.ReactNode
}

/**
 * 表单底部操作栏
 *
 * 标准布局：左侧放取消/返回等辅助操作，右侧放提交按钮。
 * 与 FormSection 保持相同的视觉节奏，顶部有分隔线。
 */
export function FormFooter({
  left,
  children,
  className,
  ...props
}: FormFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between pt-6 border-t",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {left}
      </div>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  )
}
