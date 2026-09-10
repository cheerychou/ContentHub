# ContentHub 前端组件规范

> 生效日期：2026-09-09（M5 Task 2）。本文档是 `frontend/src/components/` 的唯一规范来源；
> 与 CDD3 原仓库的偏差在文中显式标注。

## 1. 来源声明

本目录组件体系提取自内部项目 **CDD3**（`/Users/zhoudabo/应用开发/CDD3`，按 MIT 约定复用；
CDD3 仓库当前未附带 LICENSE 文件），单向提取、CDD3 路径只读，不写回：

| 批次 | 提取日期 | 来源 | 内容 |
|---|---|---|---|
| M5 Task 1 | 2026-09-08 | CDD3 `frontend/platform-web/src/components/ui/` | token CSS 八件套、17 个 ui 原子组件（button/badge/card/input/label/select/textarea/table/tabs/separator/skeleton/spinner/tooltip/status-badge/empty-state/error-state + icons）、variants 分离件 |
| M5 Task 2 | 2026-09-09 | CDD3 `frontend/packages/shared-ui/src/components/` | `common/page-header.tsx`（PageHeader）、`ui/breadcrumb.tsx` 的 `SimpleBreadcrumb` |

提取时的统一改动：

- `import { cn } from "cn"` → `import { cn } from "@/lib/utils"`（`src/lib/utils.ts` 即 `cn` 包的 re-export）。
- `@cdd/shared-ui` 裸引用 → 拆为 `@/components/ui/*` 本地件。
- 每个提取文件的头部注释注明来源与提取日期。
- CDD3 的业务绑定件（status-config、stores、shared-http、sidebar 全家桶等）**不提取**。

## 2. 目录约定

```
frontend/
├── components.json            # shadcn CLI 配置（style new-york，base base-ui）
├── tokens/*.css               # 设计 token（自 CDD3 Style Dictionary 产物拷贝，8 个文件）
└── src/
    ├── index.css              # @import 'tailwindcss' + tokens imports（@custom-variant dark 声明在 theme-bindings.css）
    ├── lib/utils.ts           # cn（re-export npm 包 cn）
    └── components/
        ├── ui/                # shadcn 原子组件：无业务语义，纯呈现
        │   ├── button.tsx / badge.tsx / card.tsx / ...
        │   └── variants/     # cva 变体定义分离（见 §3）
        ├── common/            # 业务公共组件：跨页面复用、可含业务语义（PageHeader 等）
        ├── data-display/      # 数据展示组件（自 CDD3 移植）：Statistic 等
        └── ...
```

三层职责：

| 目录 | 职责 | 例子 | 判据 |
|---|---|---|---|
| `components/ui/` | shadcn 原子组件 | Button、Badge、Card、Select | 换一个项目仍然成立 |
| `components/ui/variants/` | cva 变体定义 | ButtonVariants.ts、BadgeVariants.ts | 纯 cva 表，不渲染 JSX |
| `components/common/` | 业务公共组件 | PageHeader、（后续）ConfirmDialog 等 | 含业务文案/语义，但跨页面通用 |
| `components/data-display/` | 数据展示组件 | Statistic | 纯呈现数值卡，自 CDD3 移植（裁剪 trend） |

> 注：variants 放在 `ui/variants/`（ui 内部），与 CDD3 platform-web 的实际布局一致；
> 规划文本中「components/variants」即指此处。

## 3. variants 分离约定

组件文件保持**薄壳**：cva 变体表不放组件文件内，放到 `ui/variants/XxxVariants.ts`，
组件 import 后组装并透传 `variant` prop。

```tsx
// ui/variants/BadgeVariants.ts —— 纯 cva 表
export const badgeVariants = cva("...", { variants: { variant: {...} }, defaultVariants: {...} });

// ui/badge.tsx —— 薄壳
import { badgeVariants } from './variants/BadgeVariants';
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

收益：变体表可被多个组件复用（如 status-badge 复用 badge 的骨架样式）、组件文件可读、
与 CDD3 一致便于后续双向对照。新增带 variant 的组件时**默认走此分离**；
只有当组件无变体或变体仅一处使用且极短时，才允许内联。

## 4. 如何加新组件

### 4.1 shadcn CLI（首选）

```bash
cd frontend
npx shadcn@latest add <component>    # 例：npx shadcn@latest add alert-dialog
```

`components.json` 已配置：style `new-york`、base `base-ui`（组件基于 `@base-ui/react` 原语而非
radix）、aliases 全部指向 `@/`。装完自查两件事：

1. **import 核对**：`cn` 应来自 `@/lib/utils`（aliases 已配好，通常无需改；若 CLI 生成其它路径统一修正）。
2. **依赖核对**：`@base-ui/react`、`@phosphor-icons/react`、`class-variance-authority`、`cn`、`motion` 均已在
   package.json；若 CLI 引入了新依赖，先确认必要性再安装。

带 variant 的组件装完后，把 cva 表移入 `ui/variants/`（见 §3）。

### 4.2 从 CDD3 拷贝

CDD3 路径只读。拷贝前逐项检查：

1. `import { cn } from "cn"` → `"@/lib/utils"`。
2. `@cdd/shared-ui` / `@cdd/*` 裸引用 → 改为 `@/components/ui/*` 本地件（缺的子组件按需一并拷）。
3. 依赖核对：`base-ui` / `phosphor` / `motion` / `cva` 是否已装。
4. **业务绑定必须剥离**：CDD3 的 status-config、stores、shared-http、领域枚举一律不带过来；
   业务词汇用本项目的（见 §6）。
5. 文件头注释注明来源与提取日期。

## 5. Token 与暗色

- token 位于 `frontend/tokens/*.css`（8 个文件：tokens-saas / theme-bindings / dark-layer /
  brand-layer / tokens-typography / tokens-shadow / tokens-layout / tokens-motion），
  由 `src/index.css` 按 CDD3 同构引入；`@theme` 绑定把 CSS 变量映射为 Tailwind 工具类
  （如 `--color-card` → `bg-card`）。
- **暗色**：`dark-layer.css` 已内置全部暗色变量（在 `.dark` 作用域覆写叶子
  `--color-semantic-saas-*`），`theme-bindings.css` 声明 `@custom-variant dark (&:is(.dark *))`
  且主映射块使用 **`@theme inline`** —— inline 使工具类值在**使用处**解析 var()，
  因此根元素挂 `.dark` class 后，叶子变量被 `.dark` 覆写即整站生效，无需改任何组件。
  当前**暂无切换开关**（M5 约束：不接开关）；未来接入只需 toggle
  `document.documentElement.classList`。
- **写样式只用语义工具类**（`bg-primary`、`text-muted-foreground`、`border-border`、
  `bg-stat-3-soft` 等），不写死色值，暗色才能自动生效。

## 6. StatusBadge：ContentHub 资产状态映射

Task 1 拷入的 `ui/status-badge.tsx` **保持原样未改**：它已是通用 tone 型
（`success | warning | danger | info | default`），不携带 CDD3 status-config 绑定，
颜色走语义 token（`stat-3/stat-6/warning/destructive` + 各自 `-soft` 底色，暗色变量已就位）。

状态值 → tone 的映射不进组件（组件保持通用），由调用方按下表传递
（`Status` 定义见 `src/types.ts`，共 10 值）：

| 状态值 | 中文 | tone | 语义 |
|---|---|---|---|
| `available` | 可用 | `success` | 就绪终态 |
| `published` | 已发布 | `success` | 就绪终态 |
| `finalized` | 定稿 | `success` | 成品就绪 |
| `researching` | 调研中 | `info` | 进行中 |
| `approved` | 已立项 | `info` | 进行中 |
| `drafting` | 创作中 | `info` | 进行中 |
| `publishing` | 发布中 | `warning` | 过渡态，处理中 |
| `candidate` | 候选 | `default` | 未定/停滞 |
| `shelved` | 已搁置 | `default` | 未定/停滞 |
| `topic` | 选题 | `default` | 存量保留值 |

`danger` 预留给错误态（如发布失败），暂无对应资产状态。

Task 3 界面重构时，ZONE/STATUS 标签统一按此表换 `StatusBadge`。

## 7. PageHeader 使用规范

组件：`components/common/page-header.tsx`（提取自 CDD3 shared-ui，唯一真源）。

形态：标题（`text-xl font-semibold`）与 `subtitle`/`description`（`text-sm text-muted-foreground`）
**同一行左右结构**——标题在前、说明在后、`items-baseline` 基线对齐、间隔 32px（`gap-8`）；
右侧为 `action` 操作区；`breadcrumbItems` 渲染在标题行上方；`onBack` 传入时标题左侧渲染返回箭头。

**description/subtitle 写法准入**（源自 CDD3 `PAGE_HEADER_USAGE.md` v1.0）：

> 说明"这是什么 / 谁在看 / 数据从哪来"，不说明"你怎么用 / 这页干什么"。
> 自检法：把页面标题换掉，这句话放到别的页面还成立吗？成立 = 套话，删。

允许写（四类）：① 数据范围/口径（如"全站资产行级明细（只读）"）② 实体身份元信息（单号/编码/状态，
详情页优先走 `subtitle`）③ 状态性/权限性前提 ④ 业务口径解释。
禁止写（三类）：① 复述标题 ② 操作教学（"点击查询"类）③ 套话模板（"统一XXX入口"）。
硬约束：一句话 ≤ 30 字、句尾不加句号、禁用开头词（管理/配置/展示/用于/支持/点击/填写）。

**面包屑依赖裁决**：CDD3 的 `ui/breadcrumb.tsx` 含 react-router-dom 依赖（`PageBreadcrumb` 用
`<Link>`），本项目尚未引入路由，故**只拷贝了路由无关的 `SimpleBreadcrumb`**（纯展示，`href`
仅保留在数据类型中不渲染链接）。后续接入路由需要可跳转面包屑时，优先
`npx shadcn@latest add breadcrumb` 再改造。
