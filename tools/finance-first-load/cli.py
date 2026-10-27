"""Operational first-load entry point. No automatic run on deploy. Default is read-only plan."""
import argparse
import json
import os
import sys
from pathlib import Path
from policy import private_path,file_hash,fingerprint,validate_approval,check_confirmation,closed_snapshot
from postgres_store import connect_operational,schema_hashes,json_dumps
from executor import prepare_items,preview,apply,recover
sys.path.insert(0,str(Path(__file__).parents[1]/'finance-migration'))
from engine import source_rows

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=('plan','apply','recover'),default='plan')
    p.add_argument('--source',type=Path,required=True); p.add_argument('--matches',type=Path,required=True)
    p.add_argument('--approval',type=Path,required=True); p.add_argument('--output',type=Path,required=True)
    p.add_argument('--confirm',default='')
    args=p.parse_args()
    output=private_path(args.output)
    if output.exists(): raise ValueError('existing_evidence_output_not_overwritten')
    source=private_path(args.source); matches_path=private_path(args.matches); approval_path=private_path(args.approval)
    matches=json.loads(matches_path.read_text(encoding='utf-8')); approval=json.loads(approval_path.read_text(encoding='utf-8'))
    closed_snapshot(source)
    snapshot=file_hash(source); ddl_hashes=schema_hashes()
    rows=list(source_rows(source)) # Future execution checks source consistency, never mutates SQLite.
    closed_snapshot(source)
    if file_hash(source)!=snapshot: raise ValueError('source_changed_during_preparation')
    intent=prepare_items(rows,matches,approval['source_system'],snapshot,approval['reference_at'])
    if args.mode=='plan':
        # Plan is not execution approval and does not require a paid backup receipt.
        if approval.get('project_ref')!='umvldqzzliqmgkvoedyd' or approval.get('source_sha256')!=snapshot:
            raise ValueError('explicit_planning_destination_and_hash_required')
        digest=None
    else:
        digest=validate_approval(approval,matches,file_hash(matches_path),snapshot,ddl_hashes)
        if args.mode=='apply': check_confirmation(digest,args.confirm)
    dsn=os.environ.get('CAPUZZO_OPERATIONAL_DSN','') # Private backend only; never log DSN.
    store=connect_operational(dsn)
    committed=False
    try:
        if args.mode=='plan':
            with store.read_only():
                store.validate_references(intent)
                conditions=store.conditions(intent); planned=preview(store,intent)
                result=dict(mode='read_only_plan',plan_sha256=fingerprint(intent),conditions_sha256=fingerprint(conditions),
                            conditions=conditions,changes=planned['summary'],affected=planned['affected'],held=intent['held'],schema_hashes=ddl_hashes)
        elif args.mode=='apply':
            if file_hash(source)!=snapshot: raise ValueError('source_changed_before_execution')
            def check_source():
                closed_snapshot(source)
                if file_hash(source)!=snapshot: raise ValueError('source_changed_before_commit')
            result=apply(store,intent,approval,digest,args.confirm,before_commit=check_source)
            committed=True
        else:
            result=recover(store,intent['batch_id'],digest,args.confirm)
            committed=True
    finally: store.close()
    # Private output only; raw SQL errors and identifiable row contents never reach stdout.
    try:
        with output.open('x',encoding='utf-8') as f: f.write(json_dumps(result))
    except OSError:
        # Never imply a successful database commit was rolled back by a receipt error.
        if committed:
            print(json.dumps({'committed':True,'receipt_written':False,'action':'review_private_execution_ledger'}),file=sys.stderr)
        raise
    print(json.dumps({'mode':args.mode,'completed':True,'remote_write':args.mode!='plan'}))

if __name__=='__main__':
    try: main()
    except Exception as error:
        # A driver diagnostic can contain rejected row values or connection credentials.
        code=str(error) if isinstance(error,ValueError) and str(error).replace('_','').replace(':','').isalnum() else type(error).__name__
        print(json.dumps({'completed':False,'error_code':code}),file=sys.stderr)
        raise SystemExit(1)
