export type TranslationModelProvider =
  | 'google'
  | 'mymemory'
  | 'qwen'
  | 'zhipu'
  | 'deepseek'
  | 'openai';

export type TranslationModelQuotaStatus =
  | 'public-free'
  | 'check-console'
  | 'unconfigured';

type ProviderAvailability = Record<'qwen' | 'zhipu' | 'deepseek' | 'openai', boolean>;

type TranslationModelDefinition = {
  value: string;
  label: string;
  provider: TranslationModelProvider;
  priority: number;
  recommended: boolean;
  purpose: string;
  quotaText: string;
  quotaUrl?: string;
};

const QWEN_QUOTA_URL =
  'https://bailian.console.aliyun.com/cn-beijing/?tab=costing-balance#/costing-balance/free-quota';

const MODEL_DEFINITIONS: TranslationModelDefinition[] = [
  {
    value: 'qwen3.6-flash-2026-04-16',
    label: 'Qwen 3.6 Flash',
    provider: 'qwen',
    priority: 1,
    recommended: true,
    purpose: 'Best default for batch translation, speed, quality, and stable HTML output.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen-mt-lite',
    label: 'Qwen MT Lite',
    provider: 'qwen',
    priority: 2,
    recommended: true,
    purpose: 'Translation model for titles, descriptions, and shorter content.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen3.6-27b',
    label: 'Qwen 3.6 27B',
    provider: 'qwen',
    priority: 3,
    recommended: true,
    purpose: 'High-quality fallback when the preferred model is busy or exhausted.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen3-30b-a3b',
    label: 'Qwen3 30B A3B',
    provider: 'qwen',
    priority: 4,
    recommended: true,
    purpose: 'Fallback for long articles and technical machinery content.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen-plus-2025-01-25',
    label: 'Qwen Plus 2025-01-25',
    provider: 'qwen',
    priority: 5,
    recommended: false,
    purpose: 'Stable-version fallback for article content and SEO fields.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen3.7-max-2026-05-17',
    label: 'Qwen 3.7 Max',
    provider: 'qwen',
    priority: 6,
    recommended: false,
    purpose: 'Quality-first fallback; usually slower and more expensive.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen3-235b-a22b',
    label: 'Qwen3 235B A22B',
    provider: 'qwen',
    priority: 7,
    recommended: false,
    purpose: 'Large-model fallback; not recommended as the daily batch default.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen-turbo',
    label: 'Qwen Turbo',
    provider: 'qwen',
    priority: 8,
    recommended: false,
    purpose: 'General fast fallback model.',
    quotaText: 'Open Bailian to view quota and billing status.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen-plus',
    label: 'Qwen Plus',
    provider: 'qwen',
    priority: 9,
    recommended: false,
    purpose: 'General quality fallback model.',
    quotaText: 'Open Bailian to view quota and billing status.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen-coder-plus',
    label: 'Qwen Coder Plus',
    provider: 'qwen',
    priority: 10,
    recommended: false,
    purpose: 'Code-oriented fallback only when other Qwen models are unavailable.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'qwen3-vl-plus',
    label: 'Qwen3 VL Plus',
    provider: 'qwen',
    priority: 11,
    recommended: false,
    purpose: 'Vision model; not recommended for normal batch text translation.',
    quotaText: 'Independent free quota; open Bailian to view the live balance.',
    quotaUrl: QWEN_QUOTA_URL,
  },
  {
    value: 'glm-4-flash-250414',
    label: 'Zhipu GLM-4-Flash',
    provider: 'zhipu',
    priority: 20,
    recommended: true,
    purpose: 'Fast non-reasoning GLM fallback; recommended domestic alternative when Qwen quota is exhausted.',
    quotaText: 'Open the Zhipu console to view the live free quota.',
  },
  {
    value: 'deepseek-chat',
    label: 'DeepSeek Chat',
    provider: 'deepseek',
    priority: 30,
    recommended: true,
    purpose: 'Fallback for Chinese understanding and SEO work; requires its own key.',
    quotaText: 'Billed against the DeepSeek account balance.',
  },
  {
    value: 'gpt-5.6-luna',
    label: 'OpenAI GPT-5.6 Luna',
    provider: 'openai',
    priority: 40,
    recommended: true,
    purpose: 'Fastest and cheapest of the GPT-5.6 family; good for batch SEO and translation.',
    quotaText: 'Billed against the OpenAI project balance and usage.',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'OpenAI GPT-5.6 Terra',
    provider: 'openai',
    priority: 41,
    recommended: false,
    purpose: 'Mid-tier GPT-5.6 model; balances quality and speed.',
    quotaText: 'Billed against the OpenAI project balance and usage.',
  },
  {
    value: 'gpt-5.6-sol',
    label: 'OpenAI GPT-5.6 Sol',
    provider: 'openai',
    priority: 42,
    recommended: false,
    purpose: 'Highest-quality GPT-5.6 model; slower and more expensive.',
    quotaText: 'Billed against the OpenAI project balance and usage.',
  },
  {
    value: 'google-free',
    label: 'Google Translate free test',
    provider: 'google',
    priority: 80,
    recommended: false,
    purpose: 'No-key test and automatic fallback; long-term stability is not guaranteed.',
    quotaText: 'Unofficial public endpoint; no fixed account balance is available.',
  },
  {
    value: 'mymemory-free',
    label: 'MyMemory free fallback',
    provider: 'mymemory',
    priority: 90,
    recommended: false,
    purpose: 'No-key last fallback with a limited public request allowance.',
    quotaText: 'Public free allowance; no account balance is available.',
  },
];

// \u9002\u5408\u6279\u91cf\u64cd\u4f5c\u7684\u6a21\u578b\uff08\u5feb\u3001\u4fbf\u5b9c\u3001\u975e\u63a8\u7406\u3001\u7ed3\u6784\u5316\u8f93\u51fa\u7a33\u5b9a\uff09\uff0c\u5217\u8868\u91cc\u7f6e\u9876 + \u6253\u300c\u9002\u5408\u6279\u91cf\u300d\u6807\u3002
const BATCH_SUITABLE = new Set([
  'qwen3.6-flash-2026-04-16',
  'qwen-mt-lite',
  'qwen3.6-27b',
  'qwen3-30b-a3b',
  'qwen-plus-2025-01-25',
  'qwen-turbo',
  'glm-4-flash-250414',
  'deepseek-chat',
  'gpt-5.6-luna',
]);

export function buildTranslationModelCatalog(availability: ProviderAvailability) {
  return MODEL_DEFINITIONS.map((definition) => {
    const requiresKey = ['qwen', 'zhipu', 'deepseek', 'openai'].includes(definition.provider);
    const available = requiresKey
      ? availability[definition.provider as keyof ProviderAvailability]
      : true;
    const quotaStatus: TranslationModelQuotaStatus = !available
      ? 'unconfigured'
      : requiresKey
        ? 'check-console'
        : 'public-free';
    const quotaText = available ? definition.quotaText : 'API Key is not configured.';
    const quotaLabel = !available
      ? '\u672a\u914d\u7f6e'
      : requiresKey
        ? '\u5b9e\u65f6\u67e5\u770b'
        : '\u516c\u5171\u514d\u8d39';
    return {
      ...definition,
      batch: BATCH_SUITABLE.has(definition.value),
      available,
      quotaStatus,
      quotaText,
      remainingQuota: null,
      displayLabel: `#${definition.priority}${BATCH_SUITABLE.has(definition.value) ? ' \u9002\u5408\u6279\u91cf' : ''}${definition.recommended ? ' \u63a8\u8350' : ''} | ${definition.label} | \u989d\u5ea6: ${quotaLabel}`,
    };
  }).sort((left, right) => (left.batch === right.batch ? left.priority - right.priority : left.batch ? -1 : 1));
}
