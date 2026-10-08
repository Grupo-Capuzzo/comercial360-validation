"""Fail on missing/extra tests, skips, expected failures or unavailable PostgreSQL."""
import argparse
import sys
import unittest
from pathlib import Path

def main():
    p=argparse.ArgumentParser(); p.add_argument('suite',choices=('unit','postgres','projection')); p.add_argument('expected',type=int); args=p.parse_args()
    root=Path(__file__).parent
    if args.suite=='unit': suite=unittest.defaultTestLoader.discover(str(root),pattern='test_*.py')
    elif args.suite=='projection':
        suite=unittest.defaultTestLoader.discover(str(root.parent/'portal-integration'),pattern='test_*.py')
    else:
        from postgres_rehearsal import FirstLoadPostgresTests
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(FirstLoadPostgresTests)
    if suite.countTestCases()!=args.expected or args.expected<=0:
        raise SystemExit('unexpected_or_zero_test_count')
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful() or result.skipped or result.expectedFailures or result.unexpectedSuccesses or result.testsRun!=args.expected:
        raise SystemExit(1)

if __name__=='__main__': main()
