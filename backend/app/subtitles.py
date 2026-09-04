"""SRT 字幕断句与生成（KNW-EXP-001 L-001：断句是独立步骤，只看词与标点）。"""
SENT_END = "。！？；!?;"
CLAUSE = "，,、：:"


def _plain_len(text: str) -> int:
    return len(text) - sum(text.count(c) for c in SENT_END + CLAUSE)


def split_sentences(words: list[dict], max_chars: int = 16) -> list[dict]:
    sentences: list[dict] = []
    cur: list[dict] = []

    def flush(idx: int) -> None:
        if not cur:
            return
        taken = cur[: idx + 1]
        sentences.append({
            "text": "".join(w["text"] for w in taken),
            "start": taken[0]["start"],
            "end": taken[-1]["end"],
        })
        del cur[: idx + 1]

    for w in words:
        cur.append(w)
        joined = "".join(x["text"] for x in cur)
        # 句末标点 → 断
        if joined and joined[-1] in SENT_END:
            flush(len(cur) - 1)
            continue
        # 超长 → 回溯最近次级标点，否则硬断当前词
        if _plain_len(joined) >= max_chars:
            comma_idx = next(
                (i for i in range(len(cur) - 2, -1, -1)
                 if cur[i]["text"] and cur[i]["text"][-1] in CLAUSE),
                None,
            )
            flush(len(cur) - 1 if comma_idx is None else comma_idx)
    if cur:
        flush(len(cur) - 1)
    return sentences


def _ts(sec: float) -> str:
    ms = round(sec * 1000)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(sentences: list[dict]) -> str:
    blocks = []
    for i, x in enumerate(sentences, 1):
        blocks.append(f"{i}\n{_ts(x['start'])} --> {_ts(x['end'])}\n{x['text']}")
    return "\n\n".join(blocks) + ("\n" if sentences else "")
