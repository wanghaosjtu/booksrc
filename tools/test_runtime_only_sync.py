#!/usr/bin/env python3
"""Offline regression for safe marked-runtime synchronization."""
import contextlib
import copy
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "migration", Path(__file__).with_name("migrate_translation_sources.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class RuntimeOnlyTests(unittest.TestCase):
    def fixtures(self):
        return [
            {"bookSourceName": "IEEE", "bookSourceUrl": "https://example.test/a",
             "toc_mode": "html",
             "jsLib": "var SITE = 1;\n\n" + migration.MARKER + " old */\nold();",
             "header": "private sentinel", "loginUi": "user edited", "enabled": False,
             "ruleContent": {"content": "user content", "webJs": ""},
             "ruleToc": {"chapterList": "user TOC", "nextTocUrl": "next"}},
            {"bookSourceName": "Other", "jsLib": migration.MARKER + " old */",
             "toc_mode": "json",
             "exploreUrl": "user explore", "lastUpdateTime": 123},
            {"bookSourceName": "Unmarked", "jsLib": "function TT() {}",
             "ruleContent": {"content": "do not migrate"}},
            {"bookSourceName": "Test", "toc_mode": "html", "jsLib": migration.MARKER + " old */"},
            {"bookSourceName": "Legacy", "jsLib": migration.MARKER + " old */"},
        ]

    def test_only_existing_suffixes_change_and_repeat_is_noop(self):
        data = self.fixtures()
        before = copy.deepcopy(data)
        self.assertEqual(migration.sync_runtime_only(data), (2, 2))
        self.assertEqual(data[0]["jsLib"], "var SITE = 1;\n\n" + migration.RUNTIME)
        self.assertEqual(data[1]["jsLib"], migration.RUNTIME)
        for old, new in zip(before, data):
            self.assertEqual({k: v for k, v in old.items() if k != "jsLib"},
                             {k: v for k, v in new.items() if k != "jsLib"})
        self.assertEqual(data[2], before[2])
        self.assertEqual(data[3:], before[3:])
        self.assertEqual(migration.sync_runtime_only(data), (2, 0))

    def test_cli_does_not_read_login_backup_or_run_migrations(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "current.json"
            source.write_text(json.dumps(self.fixtures()), encoding="utf-8")
            with patch.object(migration, "SOURCE", source), \
                    patch.object(migration, "LOGIN_BACKUP", Path(temp) / "absent.json"), \
                    patch.object(migration, "restore_login_fields", side_effect=AssertionError("restore called")), \
                    patch.object(migration, "rewrite_content", side_effect=AssertionError("rewrite called")), \
                    patch.object(sys, "argv", ["migration", "--runtime-only"]), \
                    contextlib.redirect_stdout(io.StringIO()):
                migration.main()
                written = source.read_bytes()
                migration.main()
                self.assertEqual(source.read_bytes(), written)
            self.assertEqual(len(json.loads(written)), 5)

    def test_no_marker_fails_without_changing_input(self):
        data = [{"jsLib": "user library"}]
        with self.assertRaises(SystemExit):
            migration.sync_runtime_only(data)
        self.assertEqual(data, [{"jsLib": "user library"}])

    def test_all_network_sources_are_noop_without_login_backup(self):
        data = [{"bookSourceUrl": "https://example.test/" + str(i),
                 "jsLib": "/* legado-common-loader v2 */\nuser_library();"} for i in range(3)]
        self.assertEqual(migration.sync_runtime_only(data), (0, 0))
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "current.json"
            source.write_text(json.dumps(data), encoding="utf-8")
            before = source.read_bytes()
            with patch.object(migration, "SOURCE", source), \
                    patch.object(migration, "LOGIN_BACKUP", Path(temp) / "absent.json"), \
                    patch.object(sys, "argv", ["migration"]), \
                    contextlib.redirect_stdout(io.StringIO()):
                migration.main()
            self.assertEqual(source.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
