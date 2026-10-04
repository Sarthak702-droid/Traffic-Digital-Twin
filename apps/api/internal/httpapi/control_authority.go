package httpapi

import (
	"context"
	"fmt"
	"sort"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

// Called with the Go command serialization lock. The simulator is the
// linearization point; a durable intent precedes dispatch and survives outage.
func (s *Server) dispatchAuthority(ctx context.Context, op string, control store.ControlWrite, mode string, locks map[string]bool) error {
	var unresolved bool
	if err := s.Store.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM command_outcomes WHERE id<>$1 AND status IN ('pending','unknown') AND response ? 'authority_intent')", store.CommandID(ctx)).Scan(&unresolved); err != nil {
		return err
	}
	if unresolved {
		return fmt.Errorf("previous control authority outcome unresolved; recover before another authority change")
	}
	state, err := s.sim.client.GetState(ctx, &pb.RunRequest{RunId: control.RunID})
	if err != nil {
		return err
	}
	if mode == "" {
		mode = state.ControlMode
	}
	if mode == "" {
		return fmt.Errorf("simulator authority protocol unavailable")
	}
	targets := []string{}
	for target, on := range locks {
		if on {
			targets = append(targets, target)
		}
	}
	sort.Strings(targets)
	command := &pb.AuthorityCommand{RunId: control.RunID, CommandId: store.CommandID(ctx), ExpectedControlEpoch: state.ControlEpoch, Mode: mode, LockedTargets: targets}
	intent := store.ControlIntent{AuthorityIntent: jsonProto(command), Operation: op, Control: control}
	if err = s.Store.Write(ctx, "control.intent", intent, nil); err != nil {
		return err
	}
	updated, err := s.sim.client.UpdateAuthority(ctx, command)
	if err != nil {
		return err
	}
	if err = s.Store.Write(ctx, op, control, nil); err != nil {
		return err
	}
	s.mu.Lock()
	s.state = updated
	s.analysis = nil
	s.mu.Unlock()
	return nil
}
