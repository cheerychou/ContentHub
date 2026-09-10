import { useCallback, useEffect, useState } from "react";
import { createRecipe, deleteRecipe, listRecipes } from "./api";
import {
  RECIPE_KIND_LABELS, type Recipe, type RecipeKind,
} from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StandardListPage } from "@/components/common/standard-list-page";
import { type Column } from "@/components/common/data-table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const KINDS: RecipeKind[] = ["cover_template", "text_prompt"];

// 类型筛选词表（SegmentTabs）：全部类型 + 两种 kind（与后端 kind 枚举对齐）
const KIND_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部类型" },
  ...KINDS.map((k) => ({ value: k, label: RECIPE_KIND_LABELS[k] })),
];

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [kind, setKind] = useState<string>("");
  const [error, setError] = useState("");
  // Dialog 内提交错误（终审修复）：页面级 error 渲染在 modal 遮罩之后不可见，
  // 新建 Dialog 提交改用 runDialog → dialogError，在 Dialog 内就地展示。
  const [dialogError, setDialogError] = useState("");

  // 新建表单
  const [nkKind, setNkKind] = useState<RecipeKind>("cover_template");
  const [nkName, setNkName] = useState("");
  const [nkDesc, setNkDesc] = useState("");
  const [nkContent, setNkContent] = useState("");
  // 新建 Dialog 开合（M6 Task 2：表单搬入 Dialog；打开即重置，避免上次输入残留）
  const [nkOpen, setNkOpen] = useState(false);
  const openCreateDialog = () => {
    setNkKind("cover_template"); setNkName(""); setNkDesc(""); setNkContent("");
    setDialogError("");
    setNkOpen(true);
  };

  const refresh = useCallback(async () => {
    try {
      setRecipes(await listRecipes(kind || undefined));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    try { setError(""); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  // 同 run，但错误写入 dialogError（Dialog 内就地展示，不被遮罩挡住）
  const runDialog = useCallback(async (fn: () => Promise<void>) => {
    try { setDialogError(""); await fn(); } catch (e) { setDialogError(e instanceof Error ? e.message : String(e)); }
  }, []);

  // 表格列（M6 Task 2）：名称 / 类型 Badge / 描述 / 更新时间 / 操作（删除）
  const columns: Column<Recipe>[] = [
    {
      key: "name", title: "名称",
      render: (r) => <p className="truncate text-sm font-medium">{r.name}</p>,
    },
    {
      key: "kind", title: "类型",
      render: (r) => (
        <Badge variant={r.kind === "cover_template" ? "secondary" : "outline"}>
          {RECIPE_KIND_LABELS[r.kind]}
        </Badge>
      ),
    },
    {
      key: "description", title: "描述",
      render: (r) => (
        <p className="max-w-xl whitespace-normal text-sm leading-relaxed text-muted-foreground">
          {r.description || "—"}
        </p>
      ),
    },
    { key: "updated_at", title: "更新时间", render: (r) => r.updated_at.slice(0, 10) },
    {
      key: "actions", title: "操作", width: "w-24",
      render: (r) => (
        <Button variant="destructive" size="sm" onClick={() => void run(async () => {
          await deleteRecipe(r.id); void refresh();
        })}>删除</Button>
      ),
    },
  ];

  return (
    <>
      <StandardListPage<Recipe>
        className="mx-auto max-w-[1100px]"
        title="提示词与模板"
        description="封面模板与文本提示词：可复用的生成资产"
        action={<Button onClick={openCreateDialog}>新建提示词</Button>}
        secondaryAction={<Button variant="outline" onClick={() => void refresh()}>刷新</Button>}
        statusFilter={{ options: KIND_FILTERS, value: kind, onChange: setKind }}
        data={recipes}
        columns={columns}
        error={error}
        onRetry={() => void refresh()}
        getRowKey={(r) => r.id}
      />

      {/* 新建 Dialog（M6 Task 2）：表单原逻辑搬入；创建成功关闭 Dialog 并刷新列表
          （终审修复：失败错误在 Dialog 内就地展示；空提交由 disabled 按钮拦截） */}
      <Dialog open={nkOpen} onOpenChange={setNkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建模板/提示词</DialogTitle>
            <DialogDescription>
              模板与提示词供内容制作/发布阶段的渲染封面、文本变体等能力复用。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {/* items：触发器显示类型标签，而非原始 value（英文枚举） */}
            <Select value={nkKind} onValueChange={(v) => setNkKind(v as RecipeKind)}
                    items={KINDS.map((k) => ({ value: k, label: RECIPE_KIND_LABELS[k] }))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{RECIPE_KIND_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="名称" value={nkName}
                   onChange={(e) => setNkName(e.target.value)} />
            <Input placeholder="描述（可选）" value={nkDesc}
                   onChange={(e) => setNkDesc(e.target.value)} />
            <Textarea placeholder="模板 / 提示词内容（支持 {title} 等占位符）"
                      value={nkContent} onChange={(e) => setNkContent(e.target.value)}
                      rows={5} />
            {dialogError && <p style={{ color: "crimson", margin: "4px 0" }}>{dialogError}</p>}
            <div className="mt-2 flex items-center gap-2">
              <Button
                disabled={!nkName || !nkContent}
                title={!nkName || !nkContent ? "请先填写名称与内容" : undefined}
                onClick={() => void runDialog(async () => {
                  await createRecipe({
                    kind: nkKind, name: nkName, content: nkContent,
                    ...(nkDesc ? { description: nkDesc } : {}),
                  });
                  setNkName(""); setNkDesc(""); setNkContent(""); void refresh();
                  setNkOpen(false); // 创建成功关闭 Dialog（对齐详情表单 Dialog 同一规则）
                })}
              >创建</Button>
              {(!nkName || !nkContent) && (
                <span className="text-sm text-muted-foreground">填写名称与内容后可创建</span>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
