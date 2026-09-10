import { inspectQuality } from './quality';
const content =
  '<h2>选型依据</h2><p>' +
  '岩芯钻机需要根据项目地层与钻孔需求确认配置，设备型号和参数应以实际规格表为准。'.repeat(
    5,
  ) +
  '</p>';
const draft = {
  title: '岩芯钻机选型',
  subtitle: '',
  summary: '实际资料选型参考',
  keywords: '岩芯钻机',
  content,
};
describe('Local Chinese article quality hints', () => {
  it('ignores markup, detects similar body, and distinguishes draft title warnings from publication blockers', () => {
    const report = inspectQuality(
      draft,
      ['岩芯钻机', '挖掘机'],
      [
        {
          id: '1',
          kind: 'job',
          title: '岩芯钻机：选型',
          content: content.replace(/<p>/g, '<p class="x">'),
          blocksDuplicate: false,
        },
      ],
    );
    expect(report.issues).toEqual([]);
    expect(report.similar[0]).toMatchObject({ score: 100, exactTitle: true });
    expect(report.stats.matchedKeywords).toEqual(['岩芯钻机']);
    expect(report.stats.missingKeywords).toEqual(['挖掘机']);
    expect(report.stats.headings).toBe(1);
  });
  it('does not inflate similarity for two tiny unrelated articles', () => {
    const report = inspectQuality(
      { ...draft, content: '<p>参数以厂家资料为准</p>' },
      [],
      [
        {
          id: '1',
          kind: 'news',
          title: '别的文章',
          content: '<p>参数以厂家资料为准</p>',
          blocksDuplicate: true,
        },
      ],
    );
    expect(report.similar).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});
