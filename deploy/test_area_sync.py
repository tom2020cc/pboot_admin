import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from contextlib import closing

spec = importlib.util.spec_from_file_location('database_actions', Path(__file__).with_name('database-actions.py'))
actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actions)


class AreaSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'site.db'
        with closing(sqlite3.connect(self.path)) as db:
            db.executescript('''
                CREATE TABLE ay_area (id INTEGER PRIMARY KEY,acode TEXT,pcode TEXT,name TEXT,domain TEXT,is_default INTEGER,
                    create_time TEXT,update_time TEXT,create_user TEXT,update_user TEXT);
                INSERT INTO ay_area VALUES (21,'en','0','English','old.example.com',0,'old','old','owner','owner');
                INSERT INTO ay_area VALUES (30,'cn','0','中文','cn.example.com',1,'old','old','owner','owner');
                INSERT INTO ay_area VALUES (40,'ru','0','Русский','ru.example.com',0,'old','old','owner','owner');
                CREATE TABLE ay_content(id INTEGER,acode TEXT,title TEXT);
                INSERT INTO ay_content VALUES (1,'en','online product');
                CREATE TABLE ay_config(name TEXT,value TEXT);
                INSERT INTO ay_config VALUES ('sn','online-license');
                CREATE TABLE ay_site(id INTEGER PRIMARY KEY,acode TEXT,domain TEXT,title TEXT);
                INSERT INTO ay_site VALUES(1,'en','https://old.example.com/','Keep title');
                INSERT INTO ay_site VALUES(2,'cn','cn.example.com','中文');
                INSERT INTO ay_site VALUES(3,'ru','ru.example.com','Русский');
            ''')
        self.areas = [dict(acode='cn', name='中文', domain='', is_default=0),
                      dict(acode='en', name='英文', domain='example.com,www.example.com', is_default=1),
                      dict(acode='fr', name='法语', domain='fr.example.com', is_default=0)]
        self.revision = actions.area_revision(self.read())

    def read(self):
        with actions.opened(self.path) as db:
            return actions.area_rows(db)

    def test_merge_preserves_ids_other_data_and_extra_languages(self):
        result = actions.sync_areas(self.path, self.areas, self.revision)
        self.assertEqual(result, dict(synced=3, added=1, preserved=1, verified=True))
        with actions.opened(self.path) as db:
            self.assertEqual(db.execute("SELECT id,create_user FROM ay_area WHERE acode='en'").fetchone(), (21, 'owner'))
            self.assertEqual(db.execute('SELECT title FROM ay_content').fetchone(), ('online product',))
            self.assertEqual(db.execute('SELECT value FROM ay_config').fetchone(), ('online-license',))
            self.assertEqual(db.execute("SELECT domain,title FROM ay_site WHERE acode='en'").fetchone(), ('https://example.com', 'Keep title'))
            self.assertEqual(db.execute("SELECT domain FROM ay_site WHERE acode='cn'").fetchone(), ('',))
            self.assertEqual(db.execute("SELECT domain FROM ay_site WHERE acode='ru'").fetchone(), ('ru.example.com',))
        actual = {row['acode']: row for row in self.read()}
        self.assertEqual(actual['cn']['domain'], '')
        self.assertEqual(actual['en']['is_default'], 1)
        self.assertEqual(actual['ru']['domain'], 'ru.example.com')
        for row in self.areas:
            self.assertEqual(actual[row['acode']], row)
        again = actions.sync_areas(self.path, self.areas, actions.area_revision(self.read()))
        self.assertEqual(again['added'], 0)

    def test_stale_preview_does_not_overwrite_new_online_edit(self):
        with actions.opened(self.path) as db:
            db.execute("UPDATE ay_area SET domain='new.example.com' WHERE acode='en'")
        before = self.read()
        with self.assertRaisesRegex(ValueError, '已变化'):
            actions.sync_areas(self.path, self.areas, self.revision)
        self.assertEqual(before, self.read())

    def test_conflicting_domain_in_preserved_region_rolls_back(self):
        self.areas[1]['domain'] = 'ru.example.com'
        before = self.read()
        with self.assertRaisesRegex(ValueError, '同一个域名'):
            actions.sync_areas(self.path, self.areas, self.revision)
        self.assertEqual(before, self.read())

    def test_invalid_defaults_domains_and_codes_do_not_write(self):
        cases = [('is_default', 0), ('domain', 'https://example.com'), ('domain', 'shanbo-rig.c'),
                 ('domain', 'foo.local'), ('domain', 'a.example.com,A.example.com'), ('acode', '../'), ('name', '')]
        before = self.read()
        for key, value in cases:
            areas = [dict(row) for row in self.areas]
            areas[1][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                actions.sync_areas(self.path, areas, self.revision)
            self.assertEqual(before, self.read())

    def test_child_collision_rolls_back_earlier_changes(self):
        with actions.opened(self.path) as db:
            db.execute("INSERT INTO ay_area(acode,pcode,name,domain,is_default) VALUES('fr','en','child','',0)")
        before = self.read()
        with self.assertRaisesRegex(ValueError, '下级区域冲突'):
            actions.sync_areas(self.path, self.areas, self.revision)
        self.assertEqual(before, self.read())

    def test_content_verification_rolls_back_trigger_changes(self):
        with actions.opened(self.path) as db:
            db.execute("CREATE TRIGGER change_area AFTER INSERT ON ay_area BEGIN UPDATE ay_area SET domain='wrong.example.com' WHERE acode='en'; END")
        before = self.read()
        with self.assertRaisesRegex(ValueError, '内容核验失败'):
            actions.sync_areas(self.path, self.areas, self.revision)
        self.assertEqual(before, self.read())


if __name__ == '__main__':
    unittest.main()
