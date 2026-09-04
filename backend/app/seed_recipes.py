"""默认配方种子：幂等，按 name 查在则跳。seed(db) 返回新增条数。

运行：python -m app.seed_recipes
"""
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Recipe, RecipeKind

COVER_TEMPLATE_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin:0; width:{{ width }}px; height:{{ height }}px; overflow:hidden;
         font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
  .bg { position:absolute; inset:0;
        background-image:url('file://{{ image_file }}');
        background-size:cover; background-position:center; }
  .scrim { position:absolute; inset:0;
           background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,.78) 100%); }
  .text { position:absolute; left:0; right:0; bottom:0; padding:{{ padding }}px; color:#fff; }
  .title { font-size:{{ title_size }}px; font-weight:700; line-height:1.3;
           text-shadow:0 2px 8px rgba(0,0,0,.6); }
  .subtitle { font-size:{{ subtitle_size }}px; opacity:.88; margin-top:{{ (subtitle_size // 2) }}px; }
</style></head><body>
  <div class="bg"></div><div class="scrim"></div>
  <div class="text"><div class="title">{{ title }}</div>
  {%- if subtitle %}<div class="subtitle">{{ subtitle }}</div>{% endif %}</div>
</body></html>
"""

KOUBO_PROMPT = """你是一名短视频口播稿撰写专家。请把下面的母版正文改写成适合抖音单平台的口播稿。
要求：
1. 全程口语化，多用短句，避免书面语和长句。
2. 开场 3 秒内抛出钩子，用悬念、反常识或利益点抓住观众。
3. 中段按"痛点—方法—证据"推进，只保留母版里的事实，不虚构数据和案例。
4. 结尾必须有明确的 CTA（关注、点赞、评论或留资，择一），一句话收束。
5. 成稿控制在 300-500 字，朗读约 60-90 秒。

母版正文：
【母版正文】"""

GEO_PROMPT = """你是一名面向 AI 搜索引擎优化（GEO）的内容策略专家。请基于下面的母版正文，从指定的用户视角改写出一篇容易被 AI 搜索引用的多视角内容。
用户视角：{perspective}
要求：
1. 站在该用户视角的真实搜索意图与提问方式组织内容，先给出直接、可引用的结论。
2. 采用"问题—答案—论据"结构，分点陈述，语言清晰无歧义。
3. 所有事实、数据、结论必须来自母版正文，不得虚构；母版未覆盖的部分明确标注"资料未提及"。
4. 输出使用 markdown 格式，含一级标题与分节小标题。

母版正文：
【母版正文】"""

WECHAT_PROMPT = """你是一名资深公众号编辑。请把下面的母版正文改写成一篇公众号推文。
要求：
1. 开头必须重写：用场景、提问或反差切入，避免与母版原文雷同，前三句内让读者明确"这篇文章对我有什么用"。
2. 按公众号阅读节奏分节，每个小标题短促有力，正文段落 2-4 行，善用加粗强调关键句。
3. 只使用母版中的事实，不虚构；结尾给出行动建议并引导在看、转发。
4. 全文 1500 字左右，使用 markdown 输出。

母版正文：
【母版正文】"""

SEEDS = [
    {
        "kind": RecipeKind.COVER_TEMPLATE,
        "name": "默认封面模板",
        "description": "内置封面渲染模板（Jinja2 HTML）。可用变量：width/height/title/subtitle/image_file/title_size/subtitle_size/padding。",
        "content": COVER_TEMPLATE_HTML,
        "meta": {
            "engine": "jinja2",
            "variables": ["width", "height", "title", "subtitle",
                          "image_file", "title_size", "subtitle_size", "padding"],
        },
    },
    {
        "kind": RecipeKind.TEXT_PROMPT,
        "name": "口播稿提示词",
        "description": "把母版正文改写为抖音口播稿：口语化短句、开场 3 秒钩子、结尾 CTA。运行时将 content 中的【母版正文】占位符 replace 为母版文本后发给 LLM。",
        "content": KOUBO_PROMPT,
        "meta": {"placeholders": ["【母版正文】"], "target": "抖音口播"},
    },
    {
        "kind": RecipeKind.TEXT_PROMPT,
        "name": "GEO 多视角提示词",
        "description": "面向 AI 搜索引擎优化，从指定用户视角改写母版为易被 AI 搜索引用的多视角内容。调用 derive-text 时须传 params: {\"perspective\": \"…\"}（如 汽车维修门店老板），运行时先替换 {perspective} 占位符，再将【母版正文】占位符 replace 为母版文本。",
        "content": GEO_PROMPT,
        "meta": {"placeholders": ["【母版正文】"], "params": ["perspective"]},
    },
    {
        "kind": RecipeKind.TEXT_PROMPT,
        "name": "公众号改编提示词",
        "description": "把母版正文改编为公众号推文：适配公众号阅读节奏、小标题分节、开头重写避免与母版雷同、约 1500 字。运行时将【母版正文】占位符 replace 为母版文本。",
        "content": WECHAT_PROMPT,
        "meta": {"placeholders": ["【母版正文】"], "target": "公众号推文"},
    },
]


def seed(db: Session) -> int:
    """写入默认配方；按 name 已存在则跳过。返回新增条数。"""
    created = 0
    for item in SEEDS:
        exists = db.query(Recipe).filter_by(name=item["name"]).first()
        if exists:
            continue
        db.add(Recipe(**item))
        created += 1
    if created:
        db.commit()
    return created


if __name__ == "__main__":
    with SessionLocal() as session:
        n = seed(session)
        print(f"seeded {n} recipes")
