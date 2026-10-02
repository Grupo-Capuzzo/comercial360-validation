"""Default dry run. Local rehearsal must be explicitly selected."""
import argparse
import collections
import json
import os
from engine import source_rows, plan, local_rehearsal


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--sqlite',required=True)
    p.add_argument('--source-system',required=True,help='Stable origin identifier, independent of snapshot')
    p.add_argument('--local-rehearsal',action='store_true')
    p.add_argument('--reference-at')
    p.add_argument('--approved-sha256')
    args=p.parse_args()
    if args.local_rehearsal:
        if not args.reference_at:
            p.error('--reference-at is required for a local rehearsal')
        try:
            result=local_rehearsal(args.sqlite,os.environ['FINANCE_LOCAL_POSTGRES_DSN'],args.source_system,args.reference_at,args.approved_sha256)
        except Exception as error:
            # Driver errors may contain row values or a DSN. Never emit them.
            print(json.dumps({'failed':True,'error_type':type(error).__name__,'details':'private investigation required'}))
            raise SystemExit(1)
        print(json.dumps(result))
    else:
        counts=collections.Counter(a[0] for a in plan(list(source_rows(args.sqlite)),{},args.source_system))
        print(json.dumps({'mode':'source_only_dry_run','destination_compared':False,'potential_inserts_into_empty_fidelity_layer':sum(counts.values()),'by_table':dict(counts)}))
