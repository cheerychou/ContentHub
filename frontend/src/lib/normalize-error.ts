/**
 * 将任意 error 归一化为用户友好的错误消息字符串。
 *
 * 统一消除调用方手写 `error?.message ?? '加载失败'` 的重复逻辑。
 * 处理顺序：
 *   - falsy（null/undefined/''）→ fallback
 *   - string → 直接使用
 *   - Error → 取 `.message`，空则 fallback
 *   - 含 message 字段的对象 → 取该字段
 *   - 其他 → fallback
 *
 * （自 CDD3 shared-ui 移植，2026-09-10）
 */
export function toErrorMessage(error: unknown, fallback = '加载失败'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'object' && error !== null) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}
