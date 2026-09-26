export function environmentGuideMarkdown(guide) {
  const lines = [`# ${guide.title}`, '', `更新：${guide.version}`, '', guide.summary, '', guide.basis, '', '## 配置对照', ''];
  for (const row of guide.comparisons) lines.push(`### ${row.item}`, '', `- 本地：${row.local}`, `- 宝塔：${row.baota}`, '', row.note, '');
  for (const section of guide.sections) {
    lines.push(`## ${section.title}`, '', ...section.body.flatMap(text => [text, '']));
    section.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    for (const command of section.commands) lines.push('', `### ${command.label}`, '', '```text', command.code, '```', '');
    lines.push('');
  }
  lines.push('## 官方参考', '', ...guide.references.map(reference => `- [${reference.title}](${reference.url})`), '');
  return lines.join('\n');
}
