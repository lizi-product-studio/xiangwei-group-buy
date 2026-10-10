from pathlib import Path
import tempfile
import unittest

import database_backup


class SnapshotCoordinateTests(unittest.TestCase):
    def parse(self, sql):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.sql"
            path.write_bytes(sql)
            return database_backup.snapshot_binlog_position(path)

    def test_reads_mysql_84_source_coordinate(self):
        self.assertEqual(self.parse(b"-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='mysql-bin.000042', SOURCE_LOG_POS=987;\n"),
                         ("mysql-bin.000042", 987))

    def test_reads_older_master_coordinate_for_existing_snapshots(self):
        self.assertEqual(self.parse(b"-- CHANGE MASTER TO MASTER_LOG_FILE='binlog.000007', MASTER_LOG_POS=157;\n"),
                         ("binlog.000007", 157))

    def test_missing_malformed_or_pre_header_coordinate_fails_closed(self):
        for value in (b"SELECT 1;", b"-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='bad;DROP', SOURCE_LOG_POS=4;",
                      b"-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='mysql-bin.000001', SOURCE_LOG_POS=3;"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                self.parse(value)

    def test_restore_comparison_ignores_only_source_coordinate_line(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "original.sql"
            restored = Path(directory) / "restored.sql"
            original.write_bytes(b"CREATE TABLE t (id int);\n-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='mysql-bin.000004', SOURCE_LOG_POS=158;\nINSERT INTO t VALUES (1);\n")
            restored.write_bytes(b"CREATE TABLE t (id int);\n-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='mysql-bin.000004', SOURCE_LOG_POS=69243;\nINSERT INTO t VALUES (1);\n")
            self.assertNotEqual(database_backup.digest(original), database_backup.digest(restored))
            self.assertEqual(database_backup.comparable_dump_digest(original), database_backup.comparable_dump_digest(restored))
            restored.write_bytes(restored.read_bytes().replace(b"VALUES (1)", b"VALUES (2)"))
            self.assertNotEqual(database_backup.comparable_dump_digest(original), database_backup.comparable_dump_digest(restored))


if __name__ == "__main__":
    unittest.main()
