import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('domains', Path(__file__).with_name('check-language-domains.py'))
domains = importlib.util.module_from_spec(spec)
spec.loader.exec_module(domains)


class DomainChecks(unittest.TestCase):
    def test_license_error_and_other_errors_are_not_success(self):
        self.assertEqual(domains.classify_php(0, '<html>未匹配到本域名有效授权码</html>')['status'], 'fail')
        self.assertEqual(domains.classify_php(0, '<html>错误信息 模板缺失</html>')['status'], 'unknown')
        self.assertEqual(domains.classify_php(1, '')['status'], 'unknown')
        self.assertEqual(domains.classify_php(0, '<!doctype html><html>网站首页</html>')['status'], 'pass')

    def inspect(self, root):
        return domains.inspect_domain({'domain': 'ar.example.com', 'language': 'ar'}, ['ar.example.com'], '43.160.236.132', root,
            [('test.conf', 'server_name ar.example.com; include enable-php-82.conf;')],
            [{'acode': 'ar', 'domain': 'ar.example.com'}], [{'acode': 'ar', 'theme': 'ar'}])

    def test_missing_dns_still_checks_certificate_and_license(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(domains.socket, 'getaddrinfo', side_effect=socket.gaierror()), \
                patch.object(domains, 'certificate', return_value=domains.check('fail', '证书不匹配')) as cert, \
                patch.object(domains, 'homepage') as home, \
                patch.object(domains.subprocess, 'run', return_value=Mock(returncode=0, stdout='<html>未匹配到本域名有效授权码</html>')):
            row = self.inspect(Path(folder))['checks']
            self.assertEqual(row['dns']['status'], 'fail')
            self.assertEqual(row['tls']['status'], 'fail')
            self.assertEqual(row['license']['status'], 'fail')
            self.assertEqual(row['home']['status'], 'unknown')
            cert.assert_called_once()
            home.assert_not_called()

    def test_private_dns_never_requests_homepage(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(domains.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]), \
                patch.object(domains, 'certificate', return_value=domains.check('pass', 'OK')), \
                patch.object(domains, 'homepage') as home, \
                patch.object(domains.subprocess, 'run', return_value=Mock(returncode=0, stdout='<html>Page</html>')):
            self.assertEqual(self.inspect(Path(folder))['checks']['dns']['status'], 'fail')
            home.assert_not_called()

    def test_unknown_domain_never_runs_network_or_php(self):
        with patch.object(domains.socket, 'getaddrinfo') as dns, patch.object(domains.subprocess, 'run') as php:
            row = domains.inspect_domain({'domain': 'other.example.com', 'language': 'ar'}, [], '43.160.236.132', Path('/tmp'), [], [], [])
            self.assertTrue(all(c['status'] == 'unknown' for c in row['checks'].values()))
            dns.assert_not_called(); php.assert_not_called()


if __name__ == '__main__':
    unittest.main()
