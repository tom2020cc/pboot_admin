import { BadRequestException } from '@nestjs/common';
import { extractAiChoiceText, extractTranslationJson } from './ai-json';

describe('AI response parsing', () => {
  it('rejects a completion truncated by the provider', () => {
    expect(() => extractAiChoiceText({
      choices: [{ finish_reason: 'length', message: { content: '{"title":"test"' } }],
    }, 'AI 翻译')).toThrow(BadRequestException);
  });

  it('accepts fenced JSON returned by a translation model', () => {
    expect(extractTranslationJson('```json\n{"title":"Test"}\n```')).toEqual({ title: 'Test' });
  });
});
