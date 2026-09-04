"""LLM 文本生成客户端：OpenAI 兼容接口，测试用 FakeLLM。"""
from typing import Protocol

import httpx

from .config import settings


class LLMNotConfigured(RuntimeError):
    pass


class LLMClient(Protocol):
    def complete(self, system: str, user: str) -> str: ...


class OpenAICompatLLM:
    def __init__(self, base_url: str, api_key: str, model: str,
                 timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @property
    def url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def complete(self, system: str, user: str) -> str:
        resp = httpx.post(
            self.url,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.7,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


class FakeLLM:
    """确定性假实现：按 system 含子串匹配返回，未命中返回通用占位。"""

    def __init__(self, responses: dict[str, str] | None = None):
        self.responses = responses or {}

    def complete(self, system: str, user: str) -> str:
        for key, text in self.responses.items():
            if key in system:
                return text
        return f"[FakeLLM:{len(user)}字]"


_llm: LLMClient | None = None


def get_llm() -> LLMClient:
    global _llm
    if _llm is None:
        if not settings.llm_api_key:
            raise LLMNotConfigured(
                "未配置 CH_LLM_API_KEY，文本变体不可用（封面渲染不受影响）"
            )
        _llm = OpenAICompatLLM(settings.llm_base_url, settings.llm_api_key,
                               settings.llm_model)
    return _llm
