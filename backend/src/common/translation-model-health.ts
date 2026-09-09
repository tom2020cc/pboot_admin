import * as fs from 'fs';
import * as path from 'path';

export type TranslationModelHealthStatus = 'ok' | 'failed' | 'untested';

type TranslationModelHealthEntry = {
  status: 'ok' | 'failed';
  elapsedMs?: number;
  message?: string;
  testedAt?: string;
};

type TranslationModelHealthFile = {
  models?: Record<string, TranslationModelHealthEntry>;
};

const getHealthFileCandidates = () => [
  path.resolve(process.cwd(), '../tools/seo_publish_tool/ai.model-health.json'),
  path.resolve(process.cwd(), 'tools/seo_publish_tool/ai.model-health.json'),
];

const readTranslationModelHealth = () => {
  for (const filePath of getHealthFileCandidates()) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TranslationModelHealthFile;
    } catch {
      // A damaged optional health file must not prevent the admin API from starting.
    }
  }
  return {} as TranslationModelHealthFile;
};

export const applyTranslationModelHealth = <
  T extends { value: string; available: boolean; displayLabel?: string },
>(models: T[]) => {
  const health = readTranslationModelHealth().models || {};
  return models.map((model) => {
    const entry = health[model.value];
    const healthStatus: TranslationModelHealthStatus = entry?.status || 'untested';
    const operational = model.available && healthStatus !== 'failed';
    const healthLabel = !model.available
      ? '未配置'
      : healthStatus === 'ok'
        ? `绿灯可用${entry?.elapsedMs ? ` ${entry.elapsedMs}ms` : ''}`
        : healthStatus === 'failed'
          ? '红灯不可用'
          : '未测速';

    return {
      ...model,
      operational,
      healthStatus,
      healthElapsedMs: Number(entry?.elapsedMs || 0) || null,
      healthMessage: String(entry?.message || ''),
      healthTestedAt: String(entry?.testedAt || ''),
      displayLabel: `${healthLabel} | ${model.displayLabel || model.value}`,
    };
  });
};
