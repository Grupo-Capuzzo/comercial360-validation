"""Fail on absent/ignored tests, setup failure, mismatched counts or any failure."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


if __name__=='__main__':
    pattern,expected=sys.argv[1],int(sys.argv[2])
    suite=unittest.defaultTestLoader.discover(str(Path(__file__).parent),pattern=pattern)
    discovered=suite.countTestCases()
    if expected<=0 or discovered!=expected:
        print(json.dumps({'suite':pattern,'expected':expected,'discovered':discovered,'passed':False}))
        raise SystemExit(1)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    passed=result.wasSuccessful() and result.testsRun==expected and not result.skipped
    report=dict(suite=pattern,discovered=discovered,executed=result.testsRun,skipped=len(result.skipped),
                failures=len(result.failures),errors=len(result.errors),passed=passed,
                tested_sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip())
    print(json.dumps(report))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as f:
            f.write('\n```json\n'+json.dumps(report,indent=2)+'\n```\n')
    raise SystemExit(0 if passed else 1)
