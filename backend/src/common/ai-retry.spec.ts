import { fetchWithAiRetry, isFallbackableAiErrorText } from './ai-retry';

describe('fetchWithAiRetry', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stops a hanging provider request within the total deadline', async () => {
    global.fetch = jest.fn((_input, init: RequestInit = {}) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch;

    await expect(fetchWithAiRetry(
      'https://example.invalid/translate',
      { method: 'POST' },
      { attempts: 4, requestTimeoutMs: 10, totalTimeoutMs: 30, baseDelayMs: 1, maxDelayMs: 1 },
    )).rejects.toThrow('从断点继续');
  });

  it.each([
    'AI 产品翻译 返回内容不是有效 JSON',
    'AI 输出被截断，请自动切换备用模型重试',
    'Translation quality check failed: an image placeholder was removed',
    'maximum context length exceeded',
  ])('allows another provider to recover from output-quality failures: %s', (message) => {
    expect(isFallbackableAiErrorText(message)).toBe(true);
  });
});
