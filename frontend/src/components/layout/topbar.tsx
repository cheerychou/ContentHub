import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"
import { fetchHealth } from "@/api"
import { Icons } from "@/components/ui/icons"
import { SidebarTrigger } from "@/components/ui/sidebar"

const THEME_KEY = "ch-theme";

export interface TopBarProps {
  /** 当前页面标题（折叠态下作为上下文提示） */
  title?: string;
  className?: string;
}

/**
 * 应用上栏：左侧折叠开关 + 当前页标题；右侧暗色切换（写 <html>.classList
 * 并 localStorage ch-theme 记忆）与健康点（首启拉取 /api/health 一次）。
 */
export function TopBar({ title, className }: TopBarProps) {
  // 暗色：初始读 localStorage，切换写 <html>.classList + 记忆
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  // 健康点：仅挂载时探测一次；失败静默显示离线（内部工具，不做重试）
  const [healthy, setHealthy] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchHealth()
      .then(() => { if (alive) setHealthy(true); })
      .catch(() => { if (alive) setHealthy(false); });
    return () => { alive = false; };
  }, []);

  return (
    <header
      data-slot="topbar"
      className={cn(
        "flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-background px-3",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        {title && (
          <span className="truncate text-sm font-medium text-muted-foreground">{title}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          data-slot="theme-toggle"
          aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
          title={dark ? "浅色模式" : "深色模式"}
          onClick={() => setDark((d) => !d)}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {dark ? <Icons.LightMode size={16} /> : <Icons.DarkMode size={16} />}
        </button>
        <span
          data-slot="health-dot"
          title={healthy === null ? "检测服务中…" : healthy ? "服务正常" : "服务不可用"}
          className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            className={cn(
              "inline-block size-2 rounded-full",
              healthy === null ? "bg-muted-foreground/40"
                : healthy ? "bg-success" : "bg-destructive"
            )}
          />
          {healthy === null ? "检测中" : healthy ? "在线" : "离线"}
        </span>
      </div>
    </header>
  );
}
