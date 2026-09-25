import twin_pb2 as pb
from services.simulation.receipts import Receipts

def test_payload_bound_receipts_survive_restart(tmp_path):
    path=tmp_path/'receipts.sqlite'
    command=pb.PlanCommand(run_id='run',command_id='command-1',changes=[pb.TimingChange(node_id='C1',phase_id='C1-EW',green_s=30)])
    first=Receipts(path)
    assert first.status(command)=='not_found'
    first.prepare(command)
    assert first.status(command)=='unknown'
    second=Receipts(path)
    assert second.status(command)=='interrupted'
    first.accept(command)
    assert second.status(command)=='interrupted'
    assert first.status(command)=='accepted'
    changed=pb.PlanCommand();changed.CopyFrom(command);changed.changes[0].green_s=31
    assert second.status(changed)=='conflict'


def test_terminal_applied_outcome_survives_restart(tmp_path):
    command=pb.PlanCommand(run_id='run',command_id='applied-1')
    first=Receipts(tmp_path/'receipts.sqlite')
    first.prepare(command)
    first.accept(command)
    first.finish(command,'applied',42)
    second=Receipts(tmp_path/'receipts.sqlite')
    assert second.status(command)=='applied'
    assert second.applied_at(command)==42
