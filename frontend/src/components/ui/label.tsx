import * as React from "react"

import { cn } from "@/lib/utils"

// Base UI 无 Label 原语（官方 base 版组件即原生 label 元素），
// 本封装保留项目 className 约定，行为与原生 <label> 一致。
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
