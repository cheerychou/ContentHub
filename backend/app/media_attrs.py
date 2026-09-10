"""M7 素材类型属性抽取：图片（Pillow）/ 文本（字数+语言）/ 音视频（ffprobe）。

所有抽取函数失败一律返回 None/{}；assets.store_upload 另有 try/except 兜底，
上传链路永不因属性解析失败中断（失败隔离）。
"""

import contextlib
import io
import json
import os
import subprocess
import tempfile

from PIL import Image

FFPROBE_TIMEOUT_SECONDS = 120  # 2GB 母版本机 ffprobe 余量充足

# CJK 统一表意文字（含扩展 A）：用于中文占比判定
_CJK_RANGES = ((0x4E00, 0x9FFF), (0x3400, 0x4DBF))


def image_attrs(data: bytes) -> dict | None:
    """图片属性：{format, width, height}；任何解析异常 → None。"""
    try:
        with Image.open(io.BytesIO(data)) as img:
            return {"format": img.format, "width": img.width,
                    "height": img.height}
    except Exception:  # noqa: BLE001 - Pillow 异常类型不稳定，坏图不阻塞上传
        return None


def av_attrs(data_or_path, kind: str) -> dict | None:
    """音视频属性：ffprobe -print_format json（subprocess 单一接缝）。

    bytes 入参先落临时文件再探测；路径入参直接探测。
    video → {format: codec_name, width, height, duration}；audio → {duration}
    （时长取 format.duration，浮点秒）。ffprobe 缺失/非零退出/解析失败 → None。
    """
    tmp_path: str | None = None
    try:
        if isinstance(data_or_path, (bytes, bytearray)):
            fd, tmp_path = tempfile.mkstemp(suffix=".bin")
            with os.fdopen(fd, "wb") as f:
                f.write(data_or_path)
            path = tmp_path
        else:
            path = str(data_or_path)
        proc = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, check=False,
            timeout=FFPROBE_TIMEOUT_SECONDS,
        )
        if proc.returncode != 0:
            return None
        info = json.loads(proc.stdout)
        fmt = info.get("format") or {}
        duration = (float(fmt["duration"]) if fmt.get("duration") else None)
        if kind == "video":
            stream = next(
                (s for s in info.get("streams", [])
                 if s.get("codec_type") == "video"), None)
            if stream is None:
                return None
            attrs = {"format": stream.get("codec_name"),
                     "width": stream.get("width"),
                     "height": stream.get("height")}
            if duration is not None:
                attrs["duration"] = duration
            return attrs
        if kind == "audio":
            return {"duration": duration} if duration is not None else None
        return None
    except Exception:  # noqa: BLE001 - ffprobe 缺失/超时/JSON 损坏均不阻塞上传
        return None
    finally:
        if tmp_path:
            with contextlib.suppress(OSError):
                os.unlink(tmp_path)


def text_attrs(text: str) -> dict:
    """文本属性：word_count=非空白字符数；语言按非空白字符占比判定——

    CJK ≥30% → zh；ascii 字母 ≥60% → en；否则 mixed；空文本 → other。
    """
    nonspace = [c for c in text if not c.isspace()]
    if not nonspace:
        return {"word_count": 0, "language": "other"}
    n = len(nonspace)
    cjk = sum(1 for c in nonspace
              if any(lo <= ord(c) <= hi for lo, hi in _CJK_RANGES))
    letters = sum(1 for c in nonspace if c.isascii() and c.isalpha())
    if cjk / n >= 0.3:
        language = "zh"
    elif letters / n >= 0.6:
        language = "en"
    else:
        language = "mixed"
    return {"word_count": n, "language": language}


def extract_attrs(content_type: str, *, data: bytes | None = None,
                  text: str | None = None, tmp_path: str | None = None) -> dict:
    """按 content_type 分派抽取；任何异常吞掉返回 {}（上传永不因解析失败中断）。

    tmp_path：大文件路径已落盘时直传，避免整读内存（视频/音频 spool 场景）。
    """
    try:
        if content_type == "image":
            attrs = image_attrs(data or b"")
        elif content_type in ("video", "audio"):
            attrs = av_attrs(tmp_path if tmp_path is not None else (data or b""),
                             content_type)
        elif content_type in ("markdown", "docx"):
            attrs = text_attrs(text or "")
        else:
            attrs = None
        return attrs or {}
    except Exception:  # noqa: BLE001 - 失败隔离兜底：抽取绝不影响上传
        return {}
