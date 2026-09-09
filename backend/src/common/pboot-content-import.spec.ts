import initSqlJs from 'sql.js';
import { readPbootContentGroups } from './pboot-content-import';

const createContentTables = (db: any) => {
  db.run(`
    create table ay_content (
      id integer primary key,
      acode text,
      scode text,
      title text,
      filename text
    );
    create table ay_content_sort (
      acode text,
      scode text,
      name text,
      filename text,
      mcode text
    );
    insert into ay_content values (1, 'cn', '302', 'Test product', 'test-product');
    insert into ay_content_sort values ('cn', '302', 'Products', 'products', '3');
  `);
};

describe('PbootCMS product extension compatibility', () => {
  it('imports products when the extension table does not exist', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    createContentTables(db);

    const result = readPbootContentGroups(db, '3', 'product');

    expect(result.sourceRows).toBe(1);
    expect(result.groups[0].rows[0]).toMatchObject({ ext_bigpic: '', ext_video: '' });
    db.close();
  });

  it('maps customized big-picture and video columns without requiring ext_bigpic', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    createContentTables(db);
    db.run(`
      create table ay_content_ext (
        extid integer primary key,
        contentid integer,
        ext_cp_BigPic text,
        ext_Rig_Big_Pic text,
        ext_video text,
        ext_Rig_video text
      );
      insert into ay_content_ext values (
        1,
        1,
        '',
        '/static/upload/rig-large.jpg',
        '',
        'https://youtu.be/example'
      );
    `);

    const result = readPbootContentGroups(db, '3', 'product');

    expect(result.groups[0].rows[0]).toMatchObject({
      ext_bigpic: '/static/upload/rig-large.jpg',
      ext_video: 'https://youtu.be/example',
    });
    db.close();
  });
});
