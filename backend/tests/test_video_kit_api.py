"""derive-video-kit 端点：文本级切句 → TTS 词时间戳对齐 → SRT/素材清单/音频 zip。"""
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import speech as speech_mod
from app.db import get_db
from app.main import app
from app.storage import FakeStorage, get_storage
from app.subtitles import CLAUSE, SENT_END

PUNCT = SENT_END + CLAUSE


@pytest.fixture()
def fake_storage():
    return FakeStorage()


@pytest.fixture()
def client(db_session, fake_storage):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_storage] = lambda: fake_storage
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _fake_synth(captured: dict):
    """模拟 edge-tts：词文本拼接 = 输入文本去标点，逐字词 + 合成时间戳。"""

    def fake_synth(text, voice=speech_mod.DEFAULT_VOICE):
        captured.update(text=text, voice=voice)
        plain = [c for c in text if c not in PUNCT and not c.isspace()]
        return b"FAKE_MP3", [
            {"text": c, "start": i * 0.2, "end": i * 0.2 + 0.18}
            for i, c in enumerate(plain)
        ]

    return fake_synth


def _upload_master(client, text="第一句。第二句比较长一些一些。"):
    return client.post(
        "/api/assets", data={"zone": "master", "title": "定稿文章"},
        files={"file": ("a.md", text.encode("utf-8"), "text/markdown")}).json()


def test_video_kit_end_to_end(client, fake_storage, monkeypatch):
    master = _upload_master(client)

    captured = {}
    monkeypatch.setattr(speech_mod, "synthesize", _fake_synth(captured))

    resp = client.post(
        f"/api/assets/{master['id']}/derive-video-kit",
        data={"voice": "晓晓（女）", "title": "跨品牌售后语音包"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["zone"] == "publish"
    assert body["status"] == "publishing"
    assert body["content_type"] == "archive"
    assert body["meta"]["kind"] == "video_kit"
    assert body["meta"]["voice"] == "晓晓（女）"
    assert body["meta"]["sentences"] == 2
    assert body["upstream"][0]["source_asset_id"] == master["id"]
    # 展示名已映射为 edge-tts 音色值；送合成的是完整源文本
    assert captured["voice"] == "zh-CN-XiaoxiaoNeural"
    assert captured["text"].startswith("第一句。")

    detail = client.get(f"/api/assets/{body['id']}").json()
    assert detail["file_url"] == f"fake://publish/{body['object_key']}"
    zip_bytes = fake_storage.get("publish", body["object_key"])
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    assert set(zf.namelist()) == {"audio.mp3", "subtitle.srt", "shotlist.md"}
    assert zf.read("audio.mp3") == b"FAKE_MP3"

    # 字幕在句号处断开：字幕 1 = 第一句。文本级切句生效
    srt = zf.read("subtitle.srt").decode("utf-8")
    blocks = srt.strip("\n").split("\n\n")
    assert blocks[0] == "1\n00:00:00,000 --> 00:00:00,580\n第一句。"
    assert blocks[1] == "2\n00:00:00,600 --> 00:00:02,580\n第二句比较长一些一些。"

    shotlist = zf.read("shotlist.md").decode("utf-8")
    assert "[01] 第一句。 ｜ 建议画面：＿＿＿" in shotlist
    assert "[02] 第二句比较长一些一些。 ｜ 建议画面：＿＿＿" in shotlist


def test_video_kit_defaults_to_default_voice_and_title(client, monkeypatch):
    master = _upload_master(client)
    captured = {}
    monkeypatch.setattr(speech_mod, "synthesize", _fake_synth(captured))

    resp = client.post(f"/api/assets/{master['id']}/derive-video-kit", data={})
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "定稿文章 语音包"
    assert captured["voice"] == "zh-CN-XiaoxiaoNeural"


def test_video_kit_requires_text(client, db_session):
    img = client.post(
        "/api/assets", data={"zone": "master", "title": "图"},
        files={"file": ("a.png", b"\x89PNG", "image/png")}).json()
    resp = client.post(f"/api/assets/{img['id']}/derive-video-kit", data={})
    assert resp.status_code == 422


def test_video_kit_unknown_voice_rejected(client, db_session):
    master = _upload_master(client)
    resp = client.post(f"/api/assets/{master['id']}/derive-video-kit",
                       data={"voice": "不存在（男）"})
    assert resp.status_code == 422
    assert "晓晓" in resp.json()["detail"]   # 422 提示列出可选音色


def test_video_kit_tts_failure_maps_502(client, monkeypatch):
    master = _upload_master(client)

    def boom(text, voice=speech_mod.DEFAULT_VOICE, attempts=3):
        raise RuntimeError("NoAudioReceived")

    monkeypatch.setattr(speech_mod, "synthesize_with_retry", boom)
    resp = client.post(f"/api/assets/{master['id']}/derive-video-kit", data={})
    assert resp.status_code == 502
    assert "TTS" in resp.json()["detail"]


def test_video_kit_whitespace_only_text_rejected(client):
    master = _upload_master(client, text="   \n\t  ")
    resp = client.post(f"/api/assets/{master['id']}/derive-video-kit", data={})
    assert resp.status_code == 422
    assert "母版正文为空" in resp.json()["detail"]


def test_video_kit_empty_word_sequence_maps_502(client, monkeypatch):
    master = _upload_master(client)

    def empty_synth(text, voice=speech_mod.DEFAULT_VOICE, attempts=3):
        return b"", []  # TTS 静默失败：无异常但零词序列

    monkeypatch.setattr(speech_mod, "synthesize_with_retry", empty_synth)
    resp = client.post(f"/api/assets/{master['id']}/derive-video-kit", data={})
    assert resp.status_code == 502
    assert "词序列" in resp.json()["detail"]
