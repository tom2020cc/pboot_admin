import initSqlJs from 'sql.js';
const { rollback } = require('../../../tools/repair-native-product-parameters.cjs');

describe('retired PB parameter helper rollback', () => {
  it('removes only helper fields, migrates missing native images, and preserves real parameters', async () => {
    const SQL = await initSqlJs();
    const baseline = new SQL.Database();
    baseline.run('create table ay_content_ext (extid integer primary key,contentid integer,ext_cp_BigPic text,ext_weight text)');
    const db = new SQL.Database(baseline.export());
    for (const field of ['ext_bigpic', 'ext_spec_type', 'ext_shared_specs', 'ext_shared_data', 'ext_drill_depth']) db.run(`alter table ay_content_ext add column ${field} text`);
    db.run('create table ay_extfield (id integer primary key,name text,description text)');
    for (const field of ['ext_cp_BigPic', 'ext_weight', 'ext_drill_depth', 'ext_spec_type', 'ext_shared_specs', 'ext_shared_data']) db.run('insert into ay_extfield (name,description) values (?,?)', [field, field]);
    db.run("insert into ay_content_ext values (1,10,'','555','/new.jpg','core','html','json','800')");
    db.run("insert into ay_content_ext values (2,11,'/keep.jpg','777','/other.jpg','core','html','json','600')");
    try {
      expect(rollback(db, baseline)).toEqual({ removed: ['ext_spec_type', 'ext_shared_specs', 'ext_shared_data', 'ext_bigpic'], migratedImages: 1 });
      expect(db.exec('select contentid,ext_cp_BigPic,ext_weight,ext_drill_depth from ay_content_ext')[0].values).toEqual([[10, '/new.jpg', '555', '800'], [11, '/keep.jpg', '777', '600']]);
      expect(db.exec('select name from ay_extfield order by id')[0].values).toEqual([['ext_cp_BigPic'], ['ext_weight'], ['ext_drill_depth']]);
      expect(rollback(db, baseline)).toEqual({ removed: [], migratedImages: 0 });
    } finally { db.close(); baseline.close(); }
  });
});
