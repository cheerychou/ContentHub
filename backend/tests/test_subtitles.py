import pytest

from app.subtitles import split_sentences, to_srt


def _w(text, start, dur=0.2):
    return {"text": text, "start": start, "end": start + dur}


def test_split_on_sentence_punct():
    words = [_w("大家", 0.0), _w("好", 0.2), _w("。", 0.4),
             _w("今天", 0.6), _w("聊车", 0.8), _w("。", 1.0)]
    s = split_sentences(words)
    assert [x["text"] for x in s] == ["大家好。", "今天聊车。"]
    assert s[0]["start"] == 0.0 and s[1]["end"] == pytest.approx(1.2)


def test_split_on_max_chars_hard_break():
    # 无任何标点的 5 个词、每词 4 字 → 16 字上限触发硬断
    words = [_w(t, i * 0.5) for i, t in enumerate(["abcd"] * 5)]
    s = split_sentences(words, max_chars=16)
    assert len(s) == 2 and "".join(x["text"] for x in s) == "abcd" * 5


def test_split_prefers_comma_over_hard_break():
    words = [_w(t, i * 0.2) for i, t in enumerate(
        ["八个字八个字八个字四个", "，", "八个字八个字八个字四个", "。"])]
    s = split_sentences(words, max_chars=16)
    assert [x["text"] for x in s] == ["八个字八个字八个字四个，", "八个字八个字八个字四个。"]


def test_to_srt_format():
    srt = to_srt([
        {"text": "大家好。", "start": 0.0, "end": 1.2},
        {"text": "今天聊车。", "start": 1.25, "end": 2.0},
    ])
    assert srt.startswith("1\n00:00:00,000 --> 00:00:01,200\n大家好。")
    assert "2\n00:00:01,250 --> 00:00:02,000\n今天聊车。" in srt
