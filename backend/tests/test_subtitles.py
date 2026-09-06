import pytest

from app.subtitles import align_timestamps, split_text, to_srt


def test_to_srt_format():
    srt = to_srt([
        {"text": "大家好。", "start": 0.0, "end": 1.2},
        {"text": "今天聊车。", "start": 1.25, "end": 2.0},
    ])
    assert srt.startswith("1\n00:00:00,000 --> 00:00:01,200\n大家好。")
    assert "2\n00:00:01,250 --> 00:00:02,000\n今天聊车。" in srt


# ---- split_text：文本级切句（源文本标点齐全） ----


def test_split_text_breaks_on_sentence_punct():
    assert split_text("第一句。第二句比较长一些一些。") == [
        "第一句。", "第二句比较长一些一些。"]


def test_split_text_backtracks_to_clause_punct():
    # 累计正文超 16 字 → 回溯到最近的逗号断句，逗号跟随前句
    assert split_text("十二个字十二个字十二，接着又来说了十个字。") == [
        "十二个字十二个字十二，", "接着又来说了十个字。"]


def test_split_text_hard_break_without_any_punct():
    assert split_text("一" * 18) == ["一" * 16, "一" * 2]


def test_split_text_whitespace_not_counted():
    # 9 + 8 = 17 个正文 > 16：空白不计长度，在正文第 16 字处硬断
    assert split_text("一二三四五六七八九 一二三四五六七八") == [
        "一二三四五六七八九 一二三四五六七", "八"]


# ---- align_timestamps：句列表对齐 edge-tts 词时间戳 ----


def _char_words(text: str) -> list[dict]:
    plain = [c for c in text if c not in "。！？；!?;，,、：:" and not c.isspace()]
    return [{"text": c, "start": i * 0.2, "end": i * 0.2 + 0.18}
            for i, c in enumerate(plain)]


def test_align_timestamps_matches_char_counts():
    words = _char_words("第一句第二句比较长一些一些")
    timed = align_timestamps(["第一句。", "第二句比较长一些一些。"], words)
    assert [t["text"] for t in timed] == ["第一句。", "第二句比较长一些一些。"]
    assert timed[0]["start"] == pytest.approx(0.0)
    assert timed[0]["end"] == pytest.approx(0.4 + 0.18)      # 第 3 个词的词尾
    assert timed[1]["start"] == pytest.approx(0.6)           # 第 4 个词的词首
    assert timed[1]["end"] == pytest.approx(2.4 + 0.18)      # 最后一个词的词尾


def test_align_timestamps_crossing_word_goes_to_first_sentence():
    words = [{"text": "第一句二较长", "start": 0.0, "end": 0.6},   # 6 字，跨句
             {"text": "一些", "start": 0.6, "end": 1.0}]
    timed = align_timestamps(["第一句二。", "较长一些。"], words)
    # 跨界词整段归给吃到其首字的第一句
    assert timed[0] == {"text": "第一句二。", "start": 0.0, "end": 0.6}
    assert timed[1] == {"text": "较长一些。", "start": 0.6, "end": 1.0}


def test_align_timestamps_merges_punct_only_sentence():
    words = [{"text": "你好", "start": 0.0, "end": 0.4},
             {"text": "世界", "start": 0.4, "end": 0.8}]
    timed = align_timestamps(["你好。", "，", "世界。"], words)
    assert [t["text"] for t in timed] == ["你好。，", "世界。"]
    assert timed[0]["end"] == pytest.approx(0.4)
