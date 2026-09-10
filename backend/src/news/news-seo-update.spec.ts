import initSqlJs from 'sql.js';
import { NewsService } from './news.service';

describe('SEO old-article sync keeps publication date', () => {
  let db: any, service: any;
  const config = { acode: 'cn', scode: '10', sortFilename: 'news' };
  const article = {
    id: 42,
    createTime: new Date('2024-01-01T00:00:00Z'),
    thumbnail: '/keep.jpg',
    show: true,
    orderNum: 0,
  };
  const content = {
    lang: 'zh-CN',
    title: '更新文章',
    urlName: 'cn-original',
    subtitle: '',
    keywords: '钻机',
    description: '更新摘要',
    summary: '更新摘要',
    content: '<p>新正文</p>',
  };
  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    const fields = [
      'acode',
      'scode',
      'subscode',
      'title',
      'titlecolor',
      'subtitle',
      'filename',
      'author',
      'source',
      'outlink',
      'date',
      'ico',
      'pics',
      'content',
      'tags',
      'enclosure',
      'keywords',
      'description',
      'sorting',
      'status',
      'istop',
      'isrecommend',
      'isheadline',
      'visits',
      'likes',
      'oppose',
      'create_user',
      'update_user',
      'create_time',
      'update_time',
      'gtype',
      'gid',
      'gnote',
      'picstitle',
    ];
    db.run(
      `create table ay_content(id integer primary key autoincrement,${fields.map((f) => `${f} text`).join(',')})`,
    );
    db.run(
      "insert into ay_content(acode,scode,filename,title,date,create_time,visits) values ('cn','10','cn-original','原文','2020-01-02 03:04:05','2020-01-01 00:00:00','99')",
    );
    service = Object.create(NewsService.prototype);
    service.preparePbootImage = (value: string) => value;
    service.preparePbootContent = (value: string) => value;
    service.getPbootPublicBaseUrl = () => 'https://example.invalid';
  });
  afterEach(() => db.close());
  it('keeps the PB id, filename, date, creation date and counters during an SEO update', () => {
    const result = service.upsertPbootNews(
      db,
      article,
      content,
      'zh-CN',
      config,
      '/unused',
      true,
    );
    expect(result.pbootId).toBe(1);
    expect(
      db.exec(
        'select id,filename,date,create_time,visits,content from ay_content',
      )[0].values[0],
    ).toEqual([
      1,
      'cn-original',
      '2020-01-02 03:04:05',
      '2020-01-01 00:00:00',
      '99',
      '<p>新正文</p>',
    ]);
  });
  it('does not change ordinary sync behavior', () => {
    service.upsertPbootNews(db, article, content, 'zh-CN', config, '/unused');
    expect(db.exec('select date from ay_content')[0].values[0][0]).not.toBe(
      '2020-01-02 03:04:05',
    );
  });
  it('uses the original local publication date when the PB copy does not yet exist', () => {
    db.run('delete from ay_content');
    service.upsertPbootNews(
      db,
      article,
      content,
      'zh-CN',
      config,
      '/unused',
      true,
    );
    expect(db.exec('select date from ay_content')[0].values[0][0]).toBe(
      service.formatPbootDate(article.createTime),
    );
  });
  it('refuses to move an identically named PB article out of another category', () => {
    db.run("update ay_content set scode='999'");
    expect(() =>
      service.upsertPbootNews(
        db,
        article,
        content,
        'zh-CN',
        config,
        '/unused',
        true,
      ),
    ).toThrow('其他栏目');
    expect(db.exec('select title,scode from ay_content')[0].values[0]).toEqual([
      '原文',
      '999',
    ]);
  });
});
