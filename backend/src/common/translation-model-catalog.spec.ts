import {
  buildTranslationModelCatalog,
  buildTranslationModelFallbackChain,
} from './translation-model-catalog';

describe('translation model catalog', () => {
  const availability = {
    qwen: true,
    zhipu: true,
    deepseek: true,
    openai: true,
  };

  it('includes the ChatGPT latest model without making it the batch default', () => {
    const models = buildTranslationModelCatalog(availability);
    const chatLatest = models.find((item) => item.value === 'chat-latest');

    expect(chatLatest).toMatchObject({
      provider: 'openai',
      available: true,
      batch: false,
    });
    expect(models.find((item) => item.available)?.value).toBe('qwen3.6-flash-2026-04-16');
  });

  it('falls back across providers instead of retrying every model from one provider', () => {
    const models = buildTranslationModelCatalog(availability);
    const chain = buildTranslationModelFallbackChain(models, 'qwen3.6-flash-2026-04-16');

    expect(chain.map((item) => item.provider)).toEqual([
      'qwen',
      'zhipu',
      'deepseek',
      'openai',
      'google',
      'mymemory',
    ]);
  });

  it('skips providers whose API key is not configured', () => {
    const models = buildTranslationModelCatalog({
      qwen: false,
      zhipu: true,
      deepseek: false,
      openai: true,
    });
    const chain = buildTranslationModelFallbackChain(models, 'glm-4-flash-250414');

    expect(chain.map((item) => item.provider)).toEqual(['zhipu', 'openai', 'google', 'mymemory']);
  });
});
