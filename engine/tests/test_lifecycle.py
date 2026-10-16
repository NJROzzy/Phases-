import pytest

from phases_engine import InvalidTransition, Lifecycle, Phase, Status


def test_phases_advance_in_order_and_complete():
    life = Lifecycle()
    for p in list(Phase)[1:]:
        life.advance(p)
    assert life.phase is Phase.TERMINATION
    assert life.status is Status.COMPLETED
    assert [e["phase"] for e in life.log] == [p.value for p in Phase]
    assert all(e["at"].endswith("Z") for e in life.log)


@pytest.mark.parametrize("target", [Phase.EXECUTION, Phase.TERMINATION, Phase.CONCEPTION])
def test_cannot_skip_or_repeat_phases(target):
    with pytest.raises(InvalidTransition):
        Lifecycle().advance(target)


def test_pause_only_during_execution():
    life = Lifecycle()
    with pytest.raises(InvalidTransition):
        life.pause()
    life.advance(Phase.INITIALIZATION)
    life.advance(Phase.EXECUTION)
    life.pause()
    assert life.status is Status.PAUSED
    with pytest.raises(InvalidTransition):
        life.advance(Phase.EMERGENCE)
    life.resume()
    life.advance(Phase.EMERGENCE)


def test_cancel_jumps_to_termination_and_is_final():
    life = Lifecycle()
    life.advance(Phase.INITIALIZATION)
    life.end(Status.CANCELLED, "stopped")
    assert (life.phase, life.status, life.reason) == (Phase.TERMINATION, Status.CANCELLED, "stopped")
    with pytest.raises(InvalidTransition):
        life.end(Status.FAILED, "again")
    with pytest.raises(InvalidTransition):
        life.advance(Phase.EXECUTION)


def test_end_rejects_completed():
    with pytest.raises(InvalidTransition):
        Lifecycle().end(Status.COMPLETED, "no")
