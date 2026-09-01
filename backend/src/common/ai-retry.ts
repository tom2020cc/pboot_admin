export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetryableAiErrorText(text: string) {
  const lower = String(text || '').toLowerCase();
  return (
    lower.includes('"code":"1305"') ||
    lower.includes('1305') ||
    lower.includes('访问量过大') ||
    lower.includes('稍后再试') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('timeout') ||
    lower.includes('temporarily') ||
    lower.includes('server error') ||
    lower.includes('fetch failed')
  );
}

export function isFallbackableAiErrorText(text: string) {
  const lower = String(text || '').toLowerCase();
  return (
    isRetryableAiErrorText(lower) ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota exhausted') ||
    lower.includes('额度已用完') ||
    lower.includes('额度耗尽') ||
    lower.includes('余额不足') ||
    lower.includes('insufficient balance') ||
    lower.includes('model_not_found') ||
    lower.includes('model not found') ||
    lower.includes('does not exist') ||
    lower.includes('service unavailable') ||
    lower.includes('503')
  );
}

export function formatAiErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (isRetryableAiErrorText(raw)) {
    return `AI 模型繁忙或限流，已自动等待重试后仍失败。稍后可点“只重试失败项”，也可以临时切换其他模型。原始错误：${raw}`;
  }
  return raw;
}

export async function fetchWithAiRetry(
  input: string,
  init: any,
  options: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
) {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 8000;
  const maxDelayMs = options.maxDelayMs ?? 45000;
  let lastText = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) return response;

      lastText = await response.text();
      if (attempt >= attempts || !isRetryableAiErrorText(lastText)) {
        throw new Error(lastText || response.statusText);
      }
    } catch (error) {
      lastText = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts || !isRetryableAiErrorText(lastText)) {
        throw error instanceof Error ? error : new Error(lastText);
      }
    }

    await sleep(Math.min(maxDelayMs, baseDelayMs * attempt));
  }

  throw new Error(lastText || 'AI request failed');
}
