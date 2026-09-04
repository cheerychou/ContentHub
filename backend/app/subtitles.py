"""SRT 字幕断句与生成（KNW-EXP-001 L-001：断句是独立步骤，只看词与标点）。"""
SENT_END = "。！？；!?;"
CLAUSE = "，,、：:"
_PUNCT = SENT_END + CLAUSE


def _plain_len(text: str) -> int:
    """有效正文字符数：标点与空白不计。"""
    return sum(1 for c in text if c not in _PUNCT and not c.isspace())


def split_text(text: str, max_chars: int = 16) -> list[str]:
    """文本级切句（源文本标点齐全）：句末标点即断；超长回溯最近次级标点，否则硬断。

    标点跟随所属句；空白不计长度，句首尾空白在切出时剥除。
    """
    sentences: list[str] = []
    cur = ""
    for ch in text:
        cur += ch
        if ch in SENT_END:
            sentences.append(cur.strip())
            cur = ""
            continue
        if _plain_len(cur) >= max_chars:
            cut = max(cur.rfind(c) for c in CLAUSE)
            if cut >= 0:
                sentences.append(cur[: cut + 1].strip())
                cur = cur[cut + 1:]
            else:
                sentences.append(cur.strip())
                cur = ""
    tail = cur.strip()
    if tail:
        if sentences and _plain_len(tail) == 0:
            sentences[-1] += tail  # 尾部纯标点并入前句
        else:
            sentences.append(tail)
    return sentences


def align_timestamps(sentences: list[str], words: list[dict]) -> list[dict]:
    """把 split_text 的句列表对齐到 edge-tts 词级时间戳。

    词文本去标点后拼接 = 源文本去标点。逐句按正文字符数消费词：跨界词
    （一句的结尾吃到半个词）整体归给吃到其首字的句——句.start 取首词
    .start、句.end 取末词.end。纯标点句并入前句。
    """
    out: list[dict] = []
    wi = 0
    for text in sentences:
        need = _plain_len(text)
        if need == 0:
            if out:
                out[-1]["text"] += text
            continue
        first = wi
        got = 0
        while wi < len(words) and got < need:
            got += _plain_len(words[wi]["text"])
            wi += 1
        if first < len(words):
            out.append({"text": text,
                        "start": words[first]["start"],
                        "end": words[wi - 1]["end"]})
        elif out:
            out[-1]["text"] += text  # 词耗尽兜底：并入前句
    return out


def split_sentences(words: list[dict], max_chars: int = 16) -> list[dict]:
    """词级断句（旧路径）：真实 edge-tts 词表不含标点，纯 16 字硬断会退化。

    derive-video-kit 已改走 split_text + align_timestamps；保留供纯词流场景。
    """
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
