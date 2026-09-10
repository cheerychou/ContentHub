"""M7 素材类型属性抽取单测：图片（Pillow）/ 文本（字数+语言）/ 音视频（ffprobe）。

ffprobe 走 subprocess 单一接缝，用 canned JSON 喂解析器，测试不依赖本机 ffmpeg。
"""

import base64
import json
import subprocess

from app import media_attrs
from app.media_attrs import av_attrs, extract_attrs, image_attrs, text_attrs

# 1×1 红点 PNG（69 字节，真字节，同 M2 冒烟）
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1Pe"
    "AAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

CANNED_VIDEO_FFPROBE = {
    "streams": [
        {"codec_type": "audio", "codec_name": "aac"},
        {"codec_type": "video", "codec_name": "h264",
         "width": 1920, "height": 1080},
    ],
    "format": {"duration": "12.5"},
}


def _fake_run(stdout: str, returncode: int = 0):
    def run(cmd, **kwargs):
        return subprocess.CompletedProcess(
            cmd, returncode, stdout=stdout, stderr="")
    return run


# ---------- 图片 ----------

def test_image_attrs_real_png():
    assert image_attrs(PNG_1X1) == {
        "format": "PNG", "width": 1, "height": 1}


def test_image_attrs_garbage_returns_none():
    assert image_attrs(b"definitely not an image") is None


# ---------- 文本 ----------

def test_text_attrs_zh_en_mixed():
    # 中文：CJK ≥30%
    zh = text_attrs("途虎养车供应链视角分析")
    assert zh == {"word_count": 11, "language": "zh"}
    # 英文：ascii 字母 ≥60%
    en = text_attrs("Content marketing drives growth")
    assert en == {"word_count": 28, "language": "en"}
    # 混合：CJK <30% 且字母 <60%
    mixed = text_attrs("你好 hello 12345!!!")
    assert mixed == {"word_count": 15, "language": "mixed"}


def test_text_attrs_empty_is_other():
    assert text_attrs("") == {"word_count": 0, "language": "other"}
    assert text_attrs("  \n\t ") == {"word_count": 0, "language": "other"}


# ---------- 音视频（ffprobe 接缝） ----------

def test_av_attrs_parses_canned_ffprobe_json(monkeypatch, tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 16)
    monkeypatch.setattr(
        media_attrs.subprocess, "run", _fake_run(json.dumps(CANNED_VIDEO_FFPROBE)))
    # video：第一个 codec_type=video 流给尺寸，codec_name 作 format，
    # format.duration 转秒输出为 duration_seconds（契约键名）
    assert av_attrs(str(video), "video") == {
        "format": "h264", "width": 1920, "height": 1080, "duration_seconds": 12.5}
    # audio：只取时长；bytes 入参走临时文件
    assert av_attrs(b"fake-bytes", "audio") == {"duration_seconds": 12.5}


def test_av_attrs_ffprobe_failure_returns_none(monkeypatch):
    monkeypatch.setattr(media_attrs.subprocess, "run", _fake_run("", returncode=1))
    assert av_attrs(b"junk", "video") is None


# ---------- 分派 + 失败隔离 ----------

def test_extract_attrs_dispatch():
    assert extract_attrs("image", data=PNG_1X1) == {
        "format": "PNG", "width": 1, "height": 1}
    assert extract_attrs("markdown", text="你好") == {
        "word_count": 2, "language": "zh"}
    assert extract_attrs("link") == {}
    assert extract_attrs("other") == {}


def test_extract_attrs_failure_isolated(monkeypatch):
    """抽取函数炸掉也不外泄异常：吞掉返回 {}，上传链路永不中断。"""

    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(media_attrs, "image_attrs", boom)
    assert extract_attrs("image", data=b"x") == {}
