export function filterChapters(chapters, query) {
  const tokens = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return chapters.filter(chapter => {
    const text = JSON.stringify(chapter).toLocaleLowerCase();
    return tokens.every(token => text.includes(token));
  });
}

export function parseProgress(raw, validIds) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && validIds.includes(id)))] : [];
  } catch { return []; }
}

export function guideMarkdown(guide, media, mediaBase) {
  const lines = [`# ${guide.title}`, '', guide.summary, '', `版本：${guide.version}；实操记录：${guide.recordedAt}`, '', guide.scope, ''];
  for (const [index, chapter] of guide.chapters.entries()) {
    lines.push(`## ${index + 1}. ${chapter.title}`, '', chapter.intro, '');
    for (const step of chapter.steps) {
      lines.push(`### ${step.title}`, '', ...step.body.flatMap(text => [text, '']));
      if (step.warning) lines.push(`> 注意：${step.warning}`, '');
      for (const command of step.commands || []) lines.push(command.label, '', '```sh', command.code, '```', '');
      for (const id of step.media || []) {
        const item = media[id];
        const imageUrl = /^https?:\/\//.test(mediaBase) ? new URL(encodeURIComponent(item.file), mediaBase).href : mediaBase + encodeURIComponent(item.file);
        lines.push(`![${item.caption}](${imageUrl})`, '');
        for (const [number, arrow] of (item.arrows || []).entries()) lines.push(`${number + 1}. ${arrow.label}`);
        lines.push('');
      }
      lines.push(`- [ ] ${step.check}`, '');
    }
  }
  lines.push('## 官方参考', '');
  for (const reference of guide.references) lines.push(`- [${reference.title}](${reference.url})：${reference.note}`);
  lines.push('', '截图箭头叠加显示见后台图文教程；本 Markdown 的图片链接需要部署站可访问。', '');
  return lines.join('\n');
}
