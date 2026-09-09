import { BadRequestException } from '@nestjs/common';

export function extractAiChoiceText(
  payload: any,
  contextLabel = 'AI',
) {
  const choice = payload?.choices?.[0];
  const finishReason = String(choice?.finish_reason || '').toLowerCase();
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new BadRequestException(`${contextLabel} 输出被截断，请自动切换备用模型重试`);
  }

  const text = String(choice?.message?.content || '').trim();
  if (!text) {
    throw new BadRequestException(`${contextLabel} 返回内容为空，请自动切换备用模型重试`);
  }
  return text;
}

/**
 * Robustly extract a JSON object from an AI model's text response.
 *
 * Translators frequently wrap JSON in Markdown fences or surround it with
 * explanatory prose. This tries, in order: a direct parse, fence stripping,
 * and balanced-brace extraction with conservative cleanup. When everything
 * fails it throws a BadRequestException carrying a snippet of the raw output
 * so the caller (single draft or batch job) can surface a retryable error
 * instead of silently degrading to a low-quality free translator.
 */
export function extractTranslationJson(
  rawText: string,
  contextLabel = 'AI',
): Record<string, any> {
  const text = String(rawText ?? '').trim();
  if (!text) {
    throw new BadRequestException(`${contextLabel} 返回内容为空，无法解析翻译结果`);
  }

  // 1. Direct parse — the happy path for well-formed responses.
  try {
    return JSON.parse(text);
  } catch {
    // fall through to more tolerant extraction
  }

  // 2. Strip a single Markdown code fence (```json ... ``` or ``` ... ```).
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fenced = fenceMatch ? fenceMatch[1].trim() : '';
  if (fenced) {
    try {
      return JSON.parse(fenced);
    } catch {
      // fall through
    }
  }

  // 3. Pull out the first balanced {...} block and repair common LLM mistakes.
  const braceMatch = (fenced || text).match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(repairCommonJsonErrors(braceMatch[0]));
    } catch {
      // fall through to the final error
    }
  }

  throw new BadRequestException(
    `${contextLabel} 返回内容不是有效 JSON：${text.slice(0, 200)}`,
  );
}

/**
 * Best-effort repair of the JSON mistakes LLMs most commonly make.
 * Kept conservative on purpose — aggressive rewrites risk corrupting valid
 * translated content inside string values.
 */
function repairCommonJsonErrors(json: string): string {
  return json.replace(/,\s*([}\]])/g, '$1');
}
