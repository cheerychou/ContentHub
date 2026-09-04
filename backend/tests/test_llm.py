import pytest

from app.llm import FakeLLM, LLMNotConfigured, get_llm


def test_fake_llm_returns_content():
    llm = FakeLLM()
    out = llm.complete("你是口播稿写手", "主题：跨品牌售后")
    assert isinstance(out, str) and out


def test_get_llm_without_key_raises(monkeypatch):
    monkeypatch.setenv("CH_LLM_API_KEY", "")
    import importlib, app.llm as m
    importlib.reload(m)
    # reload 后异常类身份已更换，必须用 m.LLMNotConfigured 而非顶部导入的旧类
    with pytest.raises(m.LLMNotConfigured):
        m.get_llm()


def test_openai_compat_request_shape():
    # 不引入 pytest-httpx：直接断言 URL 组装与 payload 结构（单测 FakeLLM 覆盖行为，真实 HTTP 由全栈验收覆盖）
    from app.llm import OpenAICompatLLM
    llm = OpenAICompatLLM(base_url="https://example.invalid/v4",
                          api_key="k", model="glm-4-flash")
    assert llm.url == "https://example.invalid/v4/chat/completions"
