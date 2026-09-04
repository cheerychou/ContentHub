import pytest

from app import speech


def test_synthesize_real_short_text():
    mp3, words = speech.synthesize("大家好。", voice="zh-CN-XiaoxiaoNeural")
    assert len(mp3) > 1000
    assert words and all(set(w) >= {"text", "start", "end"} for w in words)
    assert words[-1]["end"] > words[0]["start"]


def test_voices_whitelist():
    assert speech.VOICES == {
        "晓晓（女）": "zh-CN-XiaoxiaoNeural",
        "云健（男）": "zh-CN-YunjianNeural",
        "云希（男）": "zh-CN-YunxiNeural",
    }
    assert speech.DEFAULT_VOICE in speech.VOICES.values()
    assert speech.DEFAULT_VOICE_NAME in speech.VOICES


def test_synthesize_with_retry_recovers_after_transient_failure(monkeypatch):
    monkeypatch.setattr(speech.time, "sleep", lambda _s: None)
    calls = {"n": 0}

    def flaky(text, voice=speech.DEFAULT_VOICE):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("NoAudioReceived")   # edge-tts 偶发瞬时错误
        return b"mp3", [{"text": text, "start": 0.0, "end": 0.2}]

    monkeypatch.setattr(speech, "synthesize", flaky)
    mp3, words = speech.synthesize_with_retry("你好")
    assert calls["n"] == 2
    assert mp3 == b"mp3" and words[0]["text"] == "你好"


def test_synthesize_with_retry_exhausts_and_reraises(monkeypatch):
    monkeypatch.setattr(speech.time, "sleep", lambda _s: None)
    calls = {"n": 0}

    def always_fail(text, voice=speech.DEFAULT_VOICE):
        calls["n"] += 1
        raise RuntimeError("NoAudioReceived")

    monkeypatch.setattr(speech, "synthesize", always_fail)
    with pytest.raises(RuntimeError):
        speech.synthesize_with_retry("你好")
    assert calls["n"] == 3
