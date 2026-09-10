import * as React from "react"
import { cn } from "@/lib/utils"

// （自 CDD3 shared-ui form/form-section 移植，2026-09-10：剥离 IconComponent 外部类型依赖，
//  icon 改为本仓内联类型；无路由/react-hook-form 依赖可剥。）

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  /** 右侧操作区（如「批量添加」按钮） */
  action?: React.ReactNode
  columns?: 2 | 3 | 4
}

/**
 * 表单分组区块（react-hook-form 兼容版）
 *
 * - 不做 cloneElement 注入 mode/readOnlyFields，直接渲染 children；
 * - 字段的只读/禁用由子组件自身控制；
 */
export function FormSection({
  title,
  icon: Icon,
  action,
  columns = 4,
  children,
  className,
  ...props
}: FormSectionProps) {
  // 响应式网格：移动端 1 列 → sm 中间断点 → md/lg 目标列数
  const gridCols: Record<NonNullable<FormSectionProps['columns']>, string> = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 md:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  };

  return (
    // p-6 与 Card 体系（px-6/py-6）几何对齐：卡片左缘到标题 24px，两套组件一致
    <div className={cn('flex flex-col p-6 gap-3 border rounded-lg min-w-0', className)} {...props}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-medium flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-primary" />}
          {title}
        </h2>
        {action}
      </div>
      <div className={cn('grid grid-cols-1 gap-4 text-sm min-w-0', gridCols[columns])}>
        {children}
      </div>
    </div>
  )
}
