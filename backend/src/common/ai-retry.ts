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
    lower.includes('503') ||
    lower.includes('不是有效 json') ||
    lower.includes('invalid json') ||
    lower.includes('json parse') ||
    lower.includes('返回内容为空') ||
    lower.includes('empty response') ||
    lower.includes('输出被截断') ||
    lower.includes('finish_reason') ||
    lower.includes('max_tokens') ||
    lower.includes('maximum context') ||
    lower.includes('context length') ||
    lower.includes('quality check failed')
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
  options: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    requestTimeoutMs?: number;
    totalTimeoutMs?: number;
  } = {},
) {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 8000;
  const maxDelayMs = options.maxDelayMs ?? 45000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 75000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 160000;
  const deadline = Date.now() + totalTimeoutMs;
  let lastText = '';
  const deadlineError = () => new Error(`AI 请求在 ${Math.ceil(totalTimeoutMs / 1000)} 秒内未完成，请稍后从断点继续。`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw deadlineError();
    const controller = new AbortController();
    let requestTimedOut = false;
    const requestTimer = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, Math.min(requestTimeoutMs, remainingMs));
    const sourceSignal = init?.signal as AbortSignal | undefined;
    const abortFromSource = () => controller.abort();
    if (sourceSignal?.aborted) controller.abort();
    else sourceSignal?.addEventListener('abort', abortFromSource, { once: true });

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.ok) return response;

      lastText = await response.text();
      if (attempt >= attempts || !isRetryableAiErrorText(lastText)) {
        throw new Error(lastText || response.statusText);
      }
    } catch (error) {
      lastText = requestTimedOut
        ? `AI request timeout after ${Math.ceil(Math.min(requestTimeoutMs, remainingMs) / 1000)} seconds`
        : error instanceof Error ? error.message : String(error);
      if (attempt >= attempts || !isRetryableAiErrorText(lastText)) {
        throw new Error(lastText);
      }
    } finally {
      clearTimeout(requestTimer);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    }

    const delayMs = Math.min(maxDelayMs, baseDelayMs * attempt);
    if (Date.now() + delayMs >= deadline) throw deadlineError();
    await sleep(delayMs);
  }

  throw new Error(lastText || 'AI request failed');
}
