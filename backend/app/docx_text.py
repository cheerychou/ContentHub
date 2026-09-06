"""docx 正文抽取：Word 稿接入文本变体链路。"""

import io

from docx import Document


def extract_text(data: bytes) -> str:
    """抽取 docx 全部非空段落，按换行拼接。"""
    document = Document(io.BytesIO(data))
    return "\n".join(p.text for p in document.paragraphs if p.text.strip())
