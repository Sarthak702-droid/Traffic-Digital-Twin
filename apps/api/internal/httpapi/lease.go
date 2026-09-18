package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type LeaseManager struct {
	server      *Server
	instanceID  string
	epoch       int64
	isOwner     bool
	mu          sync.RWMutex
	cancel      context.CancelFunc
}

func NewLeaseManager(s *Server) *LeaseManager {
	id := os.Getenv("GATEWAY_INSTANCE_ID")
	if id == "" {
		id = fmt.Sprintf("gateway-%d-%d", os.Getpid(), time.Now().UnixNano()%100000)
	}
	return &LeaseManager{
		server:     s,
		instanceID: id,
	}
}

func (lm *LeaseManager) InstanceID() string {
	return lm.instanceID
}

func (lm *LeaseManager) IsAuthoritative() bool {
	if lm == nil || lm.server == nil || lm.server.Store == nil {
		return true // Standalone / in-memory mode is implicitly authoritative
	}
	lm.mu.RLock()
	defer lm.mu.RUnlock()
	return lm.isOwner
}

func (lm *LeaseManager) Epoch() int64 {
	if lm == nil {
		return 0
	}
	lm.mu.RLock()
	defer lm.mu.RUnlock()
	return lm.epoch
}

// Start begins the authoritative lease loop.
func (lm *LeaseManager) Start(ctx context.Context) {
	if lm.server == nil || lm.server.Store == nil {
		return
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	lm.mu.Lock()
	lm.cancel = cancel
	lm.mu.Unlock()

	// Initial acquisition attempt
	lm.tick(leaseCtx)

	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-leaseCtx.Done():
				return
			case <-ticker.C:
				lm.tick(leaseCtx)
			}
		}
	}()
}

func (lm *LeaseManager) tick(ctx context.Context) {
	callCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	lm.mu.RLock()
	currentOwner := lm.isOwner
	currentEpoch := lm.epoch
	lm.mu.RUnlock()

	var req store.LeaseWrite
	if currentOwner && currentEpoch > 0 {
		req = store.LeaseWrite{
			Owner:   lm.instanceID,
			Epoch:   currentEpoch,
			Acquire: false,
		}
	} else {
		req = store.LeaseWrite{
			Owner:   lm.instanceID,
			Acquire: true,
		}
	}

	res, err := lm.server.Store.Lease(callCtx, req)
	if err != nil {
		slog.Debug("Lease operation failed", "error", err)
		lm.mu.Lock()
		lm.isOwner = false
		lm.mu.Unlock()
		return
	}

	m, ok := res.(map[string]any)
	if !ok {
		return
	}

	owner, _ := m["owner"].(string)
	valid, _ := m["valid"].(bool)
	var epoch int64
	if ep, ok := m["epoch"].(int64); ok {
		epoch = ep
	} else if ep, ok := m["epoch"].(float64); ok {
		epoch = int64(ep)
	}

	becameOwner := false
	lm.mu.Lock()
	if owner == lm.instanceID && valid {
		if !lm.isOwner {
			becameOwner = true
		}
		lm.isOwner = true
		lm.epoch = epoch
	} else {
		if lm.isOwner {
			slog.Warn("Lost authoritative lease", "owner", owner, "epoch", epoch)
		}
		lm.isOwner = false
	}
	lm.mu.Unlock()

	if becameOwner {
		slog.Info("Acquired authoritative run lease", "instance", lm.instanceID, "epoch", epoch)
		lm.reconstructState(ctx)
	}
}

// reconstructState restores run, mode, and locks on lease acquisition (S42).
func (lm *LeaseManager) reconstructState(ctx context.Context) {
	if lm.server.Store == nil {
		return
	}

	// 1. Reconstruct active locks
	rows, err := lm.server.Store.Pool.Query(ctx, "SELECT target FROM control_locks")
	if err == nil {
		lm.server.mu.Lock()
		if lm.server.locks == nil {
			lm.server.locks = map[string]bool{}
		} else {
			for k := range lm.server.locks {
				delete(lm.server.locks, k)
			}
		}
		for rows.Next() {
			var target string
			if rows.Scan(&target) == nil {
				lm.server.locks[target] = true
			}
		}
		rows.Close()
		lm.server.mu.Unlock()
	}

	// 2. Reconstruct active run
	runs, err := lm.server.Store.Q.ListRuns(ctx, 5)
	if err == nil {
		for _, r := range runs {
			if r.Status == "running" {
				lm.server.mu.Lock()
				lm.server.manual = r.Mode == "manual"
				id, _ := r.ID.Value()
				if lm.server.sim != nil {
					lm.server.sim.command = &pb.RunCommand{
						SchemaVersion: "1.0",
						RunId:         id.(string),
						ScenarioType:  r.ScenarioType,
						Seed:          uint32(r.Seed),
						Mode:          r.Mode,
					}
				}
				lm.server.mu.Unlock()
				break
			}
		}
	}
}
