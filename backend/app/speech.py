"""TTS 合成：edge-tts 单一网络接缝；测试经 monkeypatch speech.synthesize。"""
import asyncio

import edge_tts

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"


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
