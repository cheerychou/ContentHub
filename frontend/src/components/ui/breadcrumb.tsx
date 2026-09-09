/**
 * 面包屑（简化版）
 *
 * 提取自 CDD3 shared-ui `ui/breadcrumb.tsx` 的 `SimpleBreadcrumb`（2026-09-09，MIT）。
 * 仅保留路由无关的 SimpleBreadcrumb：CDD3 原文件的 PageBreadcrumb 依赖
 * react-router-dom 的 <Link>，本项目尚未引入路由，故未一并拷贝；
 * 后续接入路由后如需可跳转面包屑，优先 `npx shadcn@latest add breadcrumb` 再改造。
 */
import * as React from "react";
import { CaretRight } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

export interface BreadcrumbItemData {
  label: string;
  href?: string;
}

export interface SimpleBreadcrumbProps {
  items: Array<BreadcrumbItemData | string>;
  className?: string;
}

export function SimpleBreadcrumb({ items, className }: SimpleBreadcrumbProps) {
  return (
    <nav aria-label="breadcrumb" className={cn("text-sm", className)}>
      <ol className="flex items-center gap-1.5">
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <li className="text-muted-foreground">
                <CaretRight className="h-4 w-4" />
              </li>
            )}
            <li className={cn(
              index === items.length - 1
                ? "text-foreground font-medium"
                : "text-muted-foreground"
            )}>
              {typeof item === "string" ? item : (item?.label ?? "")}
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}
