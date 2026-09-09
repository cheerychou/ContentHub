import { useCallback, useEffect, useState } from "react";
import { createRecipe, deleteRecipe, listRecipes } from "./api";
import {
  RECIPE_KIND_LABELS, type Recipe, type RecipeKind,
} from "./types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/common/page-header";

const KINDS: RecipeKind[] = ["cover_template", "text_prompt"];

export default function Recipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [kind, setKind] = useState<string>("");
  const [error, setError] = useState("");

  // 新建表单
  const [nkKind, setNkKind] = useState<RecipeKind>("cover_template");
  const [nkName, setNkName] = useState("");
  const [nkDesc, setNkDesc] = useState("");
  const [nkContent, setNkContent] = useState("");

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

  return (
    <main className="mx-auto max-w-[1100px] p-4">
      <PageHeader title="ContentHub · 提示词与模板" />
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="mb-3 mt-4 flex gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as string)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部类型</SelectItem>
            {KINDS.map((k) => <SelectItem key={k} value={k}>{RECIPE_KIND_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void refresh()}>刷新</Button>
      </section>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>新建模板/提示词</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Select value={nkKind} onValueChange={(v) => setNkKind(v as RecipeKind)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{RECIPE_KIND_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="名称" className="w-48" value={nkName}
                   onChange={(e) => setNkName(e.target.value)} />
            <Input placeholder="描述（可选）" className="min-w-48 flex-1" value={nkDesc}
                   onChange={(e) => setNkDesc(e.target.value)} />
          </div>
          <Textarea placeholder="模板 / 提示词内容（支持 {title} 等占位符）"
                    value={nkContent} onChange={(e) => setNkContent(e.target.value)}
                    rows={5} />
          <div className="mt-2">
            <Button onClick={() => void run(async () => {
              if (!nkName || !nkContent) return;
              await createRecipe({
                kind: nkKind, name: nkName, content: nkContent,
                ...(nkDesc ? { description: nkDesc } : {}),
              });
              setNkName(""); setNkDesc(""); setNkContent(""); void refresh();
            })}>创建</Button>
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead><TableHead>类型</TableHead>
            <TableHead>描述</TableHead><TableHead>更新时间</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipes.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.name}</TableCell>
              <TableCell>
                <Badge variant={r.kind === "cover_template" ? "secondary" : "outline"}>
                  {RECIPE_KIND_LABELS[r.kind]}
                </Badge>
              </TableCell>
              <TableCell>{r.description || "—"}</TableCell>
              <TableCell>{r.updated_at.slice(0, 10)}</TableCell>
              <TableCell>
                <Button variant="destructive" size="sm" onClick={() => void run(async () => {
                  await deleteRecipe(r.id); void refresh();
                })}>删除</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {recipes.length === 0 && <EmptyState variant="list" size="sm" />}
    </main>
  );
}
