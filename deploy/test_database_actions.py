import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('database_actions', Path(__file__).with_name('database-actions.py'))
actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actions)


def database(path, sql):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript(sql)
    db.close()
    return path


def rows(path, query):
    with actions.opened(path) as db:
        return db.execute(query).fetchall()


class DatabaseActionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'backend').mkdir()
        (self.root / 'backend/.env').write_text('APP_ENVIRONMENT=baota\nDB_SQLJS_LOCATION=../data/admin.sqlite\nSECRET=keep\n')

    def manager(self, file, site_id, text):
        return database(file, f"""
            CREATE TABLE managed_sites (id INTEGER,code TEXT,environment TEXT,rootPath TEXT,dbPath TEXT);
            INSERT INTO managed_sites VALUES ({site_id},'demo','baota','/online','/online/data/site.db');
            CREATE TABLE user (id INTEGER,password TEXT); INSERT INTO user VALUES (1,'{text}');
            CREATE TABLE product (id INTEGER PRIMARY KEY,siteId INTEGER,title TEXT);
            INSERT INTO product VALUES (1,{site_id},'{text}');
        """)

    def test_manager_sync_preserves_accounts_and_sites_and_maps_site_ids(self):
        source = self.manager(self.root / 'source.sqlite', 1, '')
        target = self.manager(self.root / 'data/admin.sqlite', 9, 'online')
        counts = actions.sync_rows(source, target, 'manager')
        self.assertEqual(counts, {'product': 1})
        self.assertEqual(rows(target, 'SELECT * FROM product'), [(1, 9, '')])
        self.assertEqual(rows(target, 'SELECT password FROM user'), [('online',)])
        self.assertEqual(rows(target, 'SELECT id FROM managed_sites'), [(9,)])

    def test_schema_mismatch_leaves_destination_untouched(self):
        source = self.manager(self.root / 'source.sqlite', 1, 'local')
        target = self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        with actions.opened(source) as db:
            db.execute('ALTER TABLE product ADD COLUMN changed TEXT')
        with self.assertRaisesRegex(ValueError, '结构不一致'):
            actions.sync_rows(source, target, 'manager')
        self.assertEqual(rows(target, 'SELECT title FROM product'), [('online',)])

    def test_manager_preserves_environment_bound_information_drafts(self):
        source = self.manager(self.root / 'source.sqlite', 1, 'latest product')
        target = self.manager(self.root / 'data/admin.sqlite', 9, 'online')
        for path, domain in [(source, 'local.c'), (target, 'example.com')]:
            with actions.opened(path) as db:
                db.execute('CREATE TABLE site_information_draft (id INTEGER, data TEXT, baseRevision TEXT)')
                db.execute('INSERT INTO site_information_draft VALUES (1,?,?)', (domain, domain))
        counts = actions.sync_rows(source, target, 'manager')
        self.assertNotIn('site_information_draft', counts)
        self.assertEqual(rows(target, 'SELECT data,baseRevision FROM site_information_draft'), [('example.com', 'example.com')])
        self.assertEqual(rows(target, 'SELECT title FROM product'), [('latest product',)])

    def test_same_row_count_with_changed_content_is_rejected_and_rolled_back(self):
        source = self.manager(self.root / 'source.sqlite', 1, 'local')
        target = self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        for path in [source, target]:
            with actions.opened(path) as db:
                db.execute('CREATE TABLE extra (value TEXT)')
                db.execute("INSERT INTO extra VALUES ('value')")
        with actions.opened(target) as db:
            db.execute("CREATE TRIGGER change_product AFTER INSERT ON extra BEGIN UPDATE product SET title='changed by trigger'; END")
        with self.assertRaisesRegex(ValueError, '内容核验失败'):
            actions.sync_rows(source, target, 'manager')
        self.assertEqual(rows(target, 'SELECT title FROM product'), [('online',)])

    def test_content_digest_handles_blanks_unicode_blobs_and_duplicates(self):
        values = [(None, '', '钻机', b'\x00\xff'), (0, '0', 'data', b'')]
        self.assertEqual(actions.rows_digest(values), actions.rows_digest(reversed(values)))
        self.assertNotEqual(actions.rows_digest(values), actions.rows_digest(values + [values[0]]))

    def test_rename_manager_updates_only_database_setting_and_rejects_collision(self):
        target = self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        state = {'path': str(target), 'site': None}
        new = Path(actions.rename_database(self.root, state, 'renamed.sqlite'))
        self.assertFalse(target.exists())
        self.assertEqual(rows(new, 'SELECT title FROM product'), [('online',)])
        self.assertIn('DB_SQLJS_LOCATION=../data/renamed.sqlite', (self.root / 'backend/.env').read_text())
        self.assertIn('SECRET=keep', (self.root / 'backend/.env').read_text())
        (new.parent / 'existing.sqlite').write_bytes(b'existing')
        with self.assertRaisesRegex(ValueError, '已存在'):
            actions.rename_database(self.root, {'path': str(new), 'site': None}, 'existing.sqlite')
        with self.assertRaises(ValueError):
            actions.rename_database(self.root, {'path': str(new), 'site': None}, '../escape.db')

    def pb(self, path, domain, text):
        return database(path, f"""
            CREATE TABLE ay_config (name TEXT,value TEXT); INSERT INTO ay_config VALUES ('sn','{text}');
            CREATE TABLE ay_user (id INTEGER,password TEXT); INSERT INTO ay_user VALUES (1,'{text}');
            CREATE TABLE ay_area (acode TEXT,domain TEXT,is_default INTEGER); INSERT INTO ay_area VALUES ('en','{domain}',1);
            CREATE TABLE ay_site (acode TEXT,domain TEXT,theme TEXT,statistical TEXT,title TEXT);
            INSERT INTO ay_site VALUES ('en','{domain}','{text}','{text}','{text}');
            CREATE TABLE ay_company (acode TEXT,name TEXT); INSERT INTO ay_company VALUES ('en','{text}');
        """)

    def test_pb_sync_preserves_environment_and_applies_blanks(self):
        source = self.pb(self.root / 'source.db', 'local.c', '')
        target = self.pb(self.root / 'target.db', 'example.com', 'online')
        actions.sync_rows(source, target, 'site')
        self.assertEqual(rows(target, 'SELECT domain,theme,statistical,title FROM ay_site'), [('example.com', 'online', 'online', '')])
        self.assertEqual(rows(target, 'SELECT value FROM ay_config'), [('online',)])
        self.assertEqual(rows(target, 'SELECT password FROM ay_user'), [('online',)])
        self.assertEqual(rows(target, 'SELECT name FROM ay_company'), [('',)])

    def test_missing_pb_product_field_reports_label_and_does_not_write(self):
        source = self.pb(self.root / 'source.db', 'local.c', 'local')
        target = self.pb(self.root / 'target.db', 'example.com', 'online')
        for path in [source, target]:
            with actions.opened(path) as db:
                db.execute('CREATE TABLE ay_content_ext (contentid INTEGER)')
        with actions.opened(source) as db:
            db.execute('ALTER TABLE ay_content_ext ADD COLUMN ext_torque TEXT')
            db.execute('CREATE TABLE ay_extfield (name TEXT,description TEXT)')
            db.execute('INSERT INTO ay_extfield VALUES (?,?)', ('ext_torque', '最大扭矩'))
        with self.assertRaisesRegex(ValueError, r'线上缺少字段：最大扭矩（ext_torque）.*本次数据库未写入'):
            actions.sync_rows(source, target, 'site')
        self.assertEqual(rows(target, 'SELECT name FROM ay_company'), [('online',)])

    def test_online_inquiries_and_form_schema_are_preserved(self):
        source = self.pb(self.root / 'source.db', 'local.c', 'local')
        target = self.pb(self.root / 'target.db', 'example.com', 'online')
        with actions.opened(source) as db:
            db.executescript("CREATE TABLE ay_message (id INTEGER, extra TEXT); CREATE TABLE ay_form (table_name TEXT); INSERT INTO ay_form VALUES ('ay_message');")
        with actions.opened(target) as db:
            db.executescript("CREATE TABLE ay_message (id INTEGER, contact TEXT); INSERT INTO ay_message VALUES (1,'customer'); CREATE TABLE ay_form (table_name TEXT); INSERT INTO ay_form VALUES ('ay_message');")
        actions.sync_rows(source, target, 'site')
        self.assertEqual(rows(target, 'SELECT * FROM ay_message'), [(1, 'customer')])
        with actions.opened(target) as db:
            self.assertEqual(actions.columns(db, 'ay_message'), ['id', 'contact'])

    def test_pb_rename_updates_pb_config_and_manager_reference(self):
        manager = self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        site_root = self.root / 'site'
        old = self.pb(site_root / 'data/old.db', 'example.com', 'online')
        (site_root / 'config').mkdir()
        config = site_root / 'config/database.php'
        config.write_text("<?php return ['database'=>['type'=>'sqlite','dbname'=>'/data/old.db']];")
        site = {'code': 'demo', 'rootPath': str(site_root)}
        new = Path(actions.rename_database(self.root, {'path': str(old), 'site': site}, 'new.db'))
        self.assertEqual(rows(manager, 'SELECT dbPath FROM managed_sites'), [(str(new),)])
        self.assertIn("'dbname'=>'/data/new.db'", config.read_text())
        self.assertEqual(actions.php_database(site_root)[0], new)
        self.assertEqual(rows(new, 'SELECT domain FROM ay_area'), [('example.com',)])

    def form_pair(self):
        source = self.pb(self.root / 'source.db', 'local.c', 'local')
        target = self.pb(self.root / 'target.db', 'example.com', 'online')
        for path, field, value in [(source, 'telephone', 'local test'), (target, 'whatsapp', 'real customer')]:
            with actions.opened(path) as db:
                db.executescript(f"""
                    CREATE TABLE ay_form (id INTEGER PRIMARY KEY, fcode TEXT, table_name TEXT, form_name TEXT);
                    INSERT INTO ay_form VALUES (1,'1','ay_message','Message');
                    CREATE TABLE ay_form_field (id INTEGER PRIMARY KEY, fcode TEXT, name TEXT, required INTEGER);
                    INSERT INTO ay_form_field VALUES (1,'1','{field}',1);
                    CREATE TABLE ay_message (id INTEGER PRIMARY KEY, {field} TEXT(20));
                    INSERT INTO ay_message VALUES (1,'{value}');
                """)
        return source, target

    def test_form_fields_sync_without_copying_or_deleting_customer_messages(self):
        source, target = self.form_pair()
        with actions.opened(target) as db:
            db.executescript("""
                CREATE TABLE ay_diy_online (id INTEGER, phone TEXT);
                INSERT INTO ay_diy_online VALUES (7,'keep');
                INSERT INTO ay_form VALUES (9,'9','ay_diy_online','Online only');
                INSERT INTO ay_form_field VALUES (9,'9','phone',1);
            """)
        for _ in range(2):
            counts = actions.sync_rows(source, target, 'site')
            self.assertEqual(counts['ay_form_field'], 1)
            self.assertEqual(rows(target, "SELECT name FROM ay_form_field WHERE fcode='1'"), [('telephone',)])
            self.assertEqual(rows(target, 'SELECT id,whatsapp,telephone FROM ay_message'), [(1, 'real customer', None)])
            self.assertEqual(rows(target, "SELECT id,name FROM ay_form_field WHERE fcode='9'"), [(9, 'phone')])
            self.assertEqual(rows(target, 'SELECT * FROM ay_diy_online'), [(7, 'keep')])

    def test_form_mismatch_rolls_back_metadata_and_added_columns(self):
        source, target = self.form_pair()
        with actions.opened(source) as db:
            db.execute("INSERT INTO ay_form VALUES (2,'2','ay_diy_missing','New form')")
        with self.assertRaisesRegex(ValueError, '对应表单'):
            actions.sync_rows(source, target, 'site')
        self.assertEqual(rows(target, 'SELECT name FROM ay_form_field'), [('whatsapp',)])
        self.assertEqual(rows(target, 'SELECT * FROM ay_message'), [(1, 'real customer')])
        self.assertEqual(rows(target, 'SELECT name FROM ay_company'), [('online',)])

    def test_form_sync_detects_customer_mutation_and_rolls_back(self):
        source, target = self.form_pair()
        with actions.opened(target) as db:
            db.execute("CREATE TRIGGER change_message AFTER INSERT ON ay_form_field BEGIN UPDATE ay_message SET whatsapp='changed'; END")
        with self.assertRaisesRegex(ValueError, '客户留言发生变化'):
            actions.sync_rows(source, target, 'site')
        self.assertEqual(rows(target, 'SELECT * FROM ay_message'), [(1, 'real customer')])

    def test_failed_config_write_restores_original_database_name(self):
        old = self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        write = actions.write_config
        def fail_new(file, text):
            if 'new.sqlite' in text:
                raise OSError('simulated config write failure')
            return write(file, text)
        with patch.object(actions, 'write_config', fail_new), self.assertRaises(OSError):
            actions.rename_database(self.root, {'path': str(old), 'site': None}, 'new.sqlite')
        self.assertTrue(old.exists())
        self.assertFalse(old.with_name('new.sqlite').exists())
        self.assertIn('../data/admin.sqlite', (self.root / 'backend/.env').read_text())

    def test_constraint_failure_rolls_back_all_table_updates(self):
        source = self.manager(self.root / 'source.sqlite', 1, 'local')
        target = self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        with actions.opened(source) as db:
            db.execute('CREATE TABLE extra (value INTEGER)')
            db.execute('INSERT INTO extra VALUES (-1)')
        with actions.opened(target) as db:
            db.execute('CREATE TABLE extra (value INTEGER CHECK(value > 0))')
            db.execute('INSERT INTO extra VALUES (1)')
        with self.assertRaises(sqlite3.IntegrityError):
            actions.sync_rows(source, target, 'manager')
        self.assertEqual(rows(target, 'SELECT title FROM product'), [('online',)])
        self.assertEqual(rows(target, 'SELECT * FROM extra'), [(1,)])

    def test_runtime_restarts_backend_after_database_operation_failure(self):
        self.manager(self.root / 'data/admin.sqlite', 1, 'online')
        state = actions.info(self.root, {'scope': 'manager'})
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if args == ['pm2', 'jlist']:
                return json.dumps([{'name': 'pboot-admin-api', 'pm2_env': {'status': 'online'}}])
            return ''
        with patch.object(actions, 'ROOT', self.root), patch.object(actions, 'runtime_environment', return_value={}), patch.object(actions.subprocess, 'check_output', command):
            with self.assertRaisesRegex(ValueError, '名称仅支持'):
                actions.main({'action': 'rename', 'scope': 'manager', 'revision': state['revision'], 'name': '../bad.db'})
        self.assertIn(['pm2', 'stop', 'pboot-admin-api'], calls)
        self.assertEqual(calls[-1], ['pm2', 'restart', 'pboot-admin-api'])


if __name__ == '__main__':
    unittest.main()
