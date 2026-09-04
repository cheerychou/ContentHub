"""TTS 合成：edge-tts 单一网络接缝；测试经 monkeypatch speech.synthesize。"""
import asyncio
import time

import edge_tts

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_VOICE_NAME = "晓晓（女）"

# 展示名 → edge-tts 音色值：端点收展示名，未知展示名 422
VOICES = {
    "晓晓（女）": "zh-CN-XiaoxiaoNeural",
    "云健（男）": "zh-CN-YunjianNeural",
    "云希（男）": "zh-CN-YunxiNeural",
}


async def _stream(text: str, voice: str):
    audio = bytearray()
    words: list[dict] = []
    # edge-tts>=7.2 默认 boundary="SentenceBoundary"，词级时间戳需显式请求
    com = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            start = chunk["offset"] / 1e7
            words.append({"text": chunk["text"],
                          "start": start,
                          "end": start + chunk["duration"] / 1e7})
    return bytes(audio), words


def synthesize(text: str, voice: str = DEFAULT_VOICE) -> tuple[bytes, list[dict]]:
    return asyncio.run(_stream(text, voice))


def synthesize_with_retry(text: str, voice: str = DEFAULT_VOICE,
                          attempts: int = 3) -> tuple[bytes, list[dict]]:
    """edge-tts 偶发瞬时异常（如 NoAudioReceived）：重试 attempts 次，间隔 1s，
    仍失败则抛出最后一次异常（端点映射 502）。"""
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            return synthesize(text, voice)
        except Exception as exc:  # noqa: BLE001 - 上游异常类型不稳定，统一兜底重试
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(1)
    raise last_exc  # type: ignore[misc]
