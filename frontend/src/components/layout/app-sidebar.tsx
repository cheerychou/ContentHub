import * as React from "react"

import { Icons } from "@/components/ui/icons"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

/** 受控菜单项（对齐 CDD3 sidebar-menu IMenuItem 的 icon/label/badge 形态，去除路由与权限字段） */
export interface AppMenuItem {
  /** 路由 key（hash），同时作为 activeId 比对值 */
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  /** 计数徽标（undefined / 0 不显示） */
  count?: number;
}

export interface AppSidebarProps {
  items: AppMenuItem[];
  /** 当前激活项 key */
  activeId: string;
  /** 点击菜单项回调（由调用方负责跳转） */
  onSelect: (key: string) => void;
  className?: string;
}

/**
 * 应用侧边栏（受控菜单版）：品牌区 + 菜单（icon + label + count 徽标）。
 * 折叠 state 由顶层 SidebarProvider 持有；折叠时仅显示图标，悬停 Tooltip 显示标签。
 */
export function AppSidebar({ items, activeId, onSelect, className }: AppSidebarProps) {
  return (
    <Sidebar className={className}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Icons.Grid size={18} weight="bold" />
          </span>
          <span className="min-w-0 overflow-hidden group-data-[collapsible=icon]/sidebar:hidden">
            <span className="block truncate text-sm font-semibold">ContentHub</span>
            <span className="block truncate text-xs text-muted-foreground">
              内容供应链工作台
            </span>
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>工作台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                const active = item.key === activeId;
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      onClick={() => onSelect(item.key)}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon size={16}
                            className={active ? "text-sidebar-accent-foreground" : "text-muted-foreground"} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.count != null && item.count > 0 && (
                      <SidebarMenuBadge>{item.count > 99 ? "99+" : item.count}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
