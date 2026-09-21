"""Safety boundaries: never stop production, unrelated jobs or fresh recoveries."""
import copy
import unittest
from server_guard import LABEL, NAME, isolated_network, stop_reason


class StopPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {'role': 'test', 'stop_below_mib': 512}
        self.job = {'Id': 'abc', 'Name': '/' + NAME, 'State': {'Running': True},
                    'Config': {'Labels': {LABEL: 'test-v1', LABEL + '.deadline': '200'}}}
        self.previous = {'runner_id': 'abc', 'time': 95, 'low_samples': 1}

    def decide(self, available=100, now=100):
        return stop_reason(self.config, self.job, available, self.previous, now)

    def test_production_never_stops_even_expired(self):
        self.config['role'] = 'production'
        self.assertEqual(self.decide(now=300), (None, 0))

    def test_unrelated_container_never_stops(self):
        self.job['Name'] = '/production-database'
        self.assertEqual(self.decide(now=300), (None, 0))

    def test_unlabeled_container_never_stops(self):
        self.job['Config']['Labels'] = {}
        self.assertEqual(self.decide(now=300), (None, 0))

    def test_malformed_deadline_does_not_expand_authority(self):
        self.job['Config']['Labels'][LABEL + '.deadline'] = 'bad'
        self.assertEqual(self.decide(), (None, 0))

    def test_low_memory_needs_two_fresh_samples(self):
        self.previous = {}
        self.assertEqual(self.decide(), (None, 1))
        self.previous = {'runner_id': 'abc', 'time': 95, 'low_samples': 1}
        self.assertEqual(self.decide(), ('low_memory', 2))

    def test_recovered_memory_resets(self):
        self.assertEqual(self.decide(available=512), (None, 0))

    def test_stale_or_other_runner_sample_does_not_count(self):
        for changes in ({'time': 1}, {'time': 101}, {'runner_id': 'different'}):
            original = copy.copy(self.previous)
            self.previous.update(changes)
            self.assertEqual(self.decide(), (None, 1))
            self.previous = original

    def test_deadline_stops_only_running_owned_test(self):
        self.assertEqual(self.decide(available=2500, now=200), ('timeout', 0))
        self.job['State']['Running'] = False
        self.assertEqual(self.decide(now=201), (None, 0))

    def test_network_requires_owner_and_local_bridge(self):
        good = {'Driver': 'bridge', 'Scope': 'local', 'Labels': {LABEL: 'test-v1'}}
        self.assertTrue(isolated_network(good))
        for replacement in ({'Labels': {}}, {'Driver': 'host'}, {'Scope': 'swarm'}):
            self.assertFalse(isolated_network({**good, **replacement}))


if __name__ == '__main__':
    unittest.main()
