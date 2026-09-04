from app import speech


def test_synthesize_real_short_text():
    mp3, words = speech.synthesize("大家好。", voice="zh-CN-XiaoxiaoNeural")
    assert len(mp3) > 1000
    assert words and all(set(w) >= {"text", "start", "end"} for w in words)
    assert words[-1]["end"] > words[0]["start"]
