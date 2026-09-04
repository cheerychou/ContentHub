"""封面规格：平台 × 方向（2026-09 通行值；render-cover 的 spec 表单可覆盖宽高）。

抖音信息流实际展示区约为 3:4 裁切：竖版封面（1080×1920）的关键文字应放在
中间偏上区域，避免被裁。B 站官方推荐竖屏视频也用横版封面（信息流横卡片）。
"""
COVER_SPECS: dict[str, dict[str, int]] = {
    "微信公众号·横版": {"width": 900, "height": 383},
    "抖音·竖版": {"width": 1080, "height": 1920},
    "抖音·横版": {"width": 1920, "height": 1080},
    "微信视频号·竖版": {"width": 1080, "height": 1260},
    "微信视频号·横版": {"width": 1080, "height": 608},
    "哔哩哔哩·横版": {"width": 1146, "height": 717},
}

# 渲染时的排版指引（写入产物 meta，供模板作者参考）
PLATFORM_GUIDES: dict[str, str] = {
    "抖音·竖版": "信息流约 3:4 裁切：标题等关键文字置于画面中间偏上区域",
    "哔哩哔哩·横版": "竖屏视频建议画面主体居中，两侧留白适配横版卡片",
}


# 各平台上传/发布页跳转 URL（前端"去发布"按钮用，键为基础平台名）
PUBLISH_ENTRY_URLS: dict[str, str] = {
    "微信公众号": "https://mp.weixin.qq.com/",
    "抖音": "https://creator.douyin.com/",
    "微信视频号": "https://channels.weixin.qq.com/platform/post-publish",
    "哔哩哔哩": "https://member.bilibili.com/platform/upload/video/frame",
}


def base_platform(platform: str) -> str:
    """'抖音·竖版' → '抖音'（跳转 URL 与平台名归一用）。"""
    return platform.split("·", 1)[0]


def spec_for(platform: str, override: dict | None = None) -> dict[str, int]:
    base = dict(COVER_SPECS[platform])  # 未知平台 KeyError → 调用方转 422
    if override:
        base.update({k: int(v) for k, v in override.items() if k in ("width", "height")})
    return base
