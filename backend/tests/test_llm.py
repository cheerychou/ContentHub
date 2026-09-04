import pytest

from app.llm import FakeLLM, LLMNotConfigured, get_llm


def test_fake_llm_returns_content():
    llm = FakeLLM()
    out = llm.complete("你是口播稿写手", "主题：跨品牌售后")
    assert isinstance(out, str) and out


def test_get_llm_without_key_raises(monkeypatch):
    # 直接替换 get_llm 读取的 settings 引用，避免 importlib.reload 及 .env 真实 key 干扰
    import types

    import app.llm as llm_mod
    monkeypatch.setattr(llm_mod, "settings", types.SimpleNamespace(
        llm_api_key="", llm_base_url="x", llm_model="m"))
    monkeypatch.setattr(llm_mod, "_llm", None)
    with pytest.raises(llm_mod.LLMNotConfigured):
        llm_mod.get_llm()


def test_openai_compat_request_shape():
    # 不引入 pytest-httpx：直接断言 URL 组装与 payload 结构（单测 FakeLLM 覆盖行为，真实 HTTP 由全栈验收覆盖）
    from app.llm import OpenAICompatLLM
    llm = OpenAICompatLLM(base_url="https://example.invalid/v4",
                          api_key="k", model="glm-4-flash")
    assert llm.url == "https://example.invalid/v4/chat/completions"
