import * as React from "react"

import { cn } from "@/lib/utils"

interface AppFooterProps extends React.ComponentProps<"footer"> {
  className?: string;
}

/**
 * 应用底栏组件（自 CDD3 shared-ui 移植，2026-09-10，MIT；文案改为 children 可覆盖）
 */
export function AppFooter({ className, children, ...props }: AppFooterProps) {
  return (
    <footer
      className={cn(
        "shrink-0 border-t px-6 py-3 text-center text-xs text-muted-foreground/60",
        className
      )}
      {...props}
    >
      {children ?? "杭州神兵科技有限公司&emsp;&emsp;&emsp;© 2024-2026 Hangzhou Shenbing Technology Co., Ltd.&emsp;&emsp;&emsp;All Rights Reserved."}
    </footer>
  );
}
