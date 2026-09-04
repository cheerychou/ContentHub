"""四平台封面规格（2026-09 通行值；配方 meta.spec 可覆盖）。"""
COVER_SPECS: dict[str, dict[str, int]] = {
    "微信公众号": {"width": 900, "height": 383},
    "抖音": {"width": 1080, "height": 1440},
    "微信视频号": {"width": 1080, "height": 1260},
    "哔哩哔哩": {"width": 1146, "height": 717},
}


# 各平台上传/发布页跳转 URL（前端"去发布"按钮用）
PUBLISH_ENTRY_URLS: dict[str, str] = {
    "微信公众号": "https://mp.weixin.qq.com/",
    "抖音": "https://creator.douyin.com/",
    "微信视频号": "https://channels.weixin.qq.com/platform/post-publish",
    "哔哩哔哩": "https://member.bilibili.com/platform/upload/video/frame",
}


def spec_for(platform: str, override: dict | None = None) -> dict[str, int]:
    base = dict(COVER_SPECS[platform])  # 未知平台 KeyError → 调用方转 422
    if override:
        base.update({k: int(v) for k, v in override.items() if k in ("width", "height")})
    return base
