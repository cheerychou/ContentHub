"""封面排版渲染：Jinja2 模板 → Playwright Chromium 截图（离线确定性）。"""
import tempfile
from pathlib import Path

from jinja2 import Template


def render_html(recipe_content: str, context: dict) -> str:
    return Template(recipe_content).render(**context)


def screenshot(html_text: str, width: int, height: int) -> bytes:
    from playwright.sync_api import sync_playwright

    with tempfile.TemporaryDirectory() as tmp:
        html_path = Path(tmp) / "cover.html"
        html_path.write_text(html_text, encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(
                    viewport={"width": width, "height": height},
                    device_scale_factor=2,
                )
                page.goto(html_path.as_uri())
                page.wait_for_timeout(200)  # 字体/图片就绪
                return page.screenshot(type="png")
            finally:
                browser.close()
