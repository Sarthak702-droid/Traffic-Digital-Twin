# Traffic Digital Twin Rollback Plan

Procedures for clean system rollback, state restoration, and failure recovery.

---

## 1. Principles of Rollback (PRD §25)

1. **Asset Immutability**:
   - Original 12 MP4 videos and the authentic ITD v1.2 weights (`best_xl_ITD_v1.2.pt`) are immutable and outside Git.
   - Rollback never deletes or alters raw video files or original weights.
2. **Deterministic Run Separation**:
   - Mode or configuration changes create separate run IDs.
   - Two authoritative engines are never executed against the same run ID.
3. **Receipt and Audit Preservation**:
   - SQLite command receipts and PostgreSQL audit logs are preserved across rollbacks to maintain forensic traceability.

---

## 2. Git & Source Code Rollback

To roll back code changes to the verified baseline commit (`d6d774f6fb187ffc07925e0768add15ab53d548c`):
```bash
git checkout feature/itd-traffic-twin-v1
git reset --hard d6d774f6fb187ffc07925e0768add15ab53d548c
```
To preserve current work on a recovery branch before rollback:
```bash
git branch backup/itd-traffic-twin-$(date +%Y%m%d%H%M%S)
```

---

## 3. Database Migration Rollback

To revert the video observations migration (`005_video_observations.sql`):
```sql
-- Connect to PostgreSQL container on 5433
docker exec -i trafficdigitaltwin-postgres-1 psql -U twin -d twin <<EOF
DROP TABLE IF EXISTS camera_observations CASCADE;
DELETE FROM schema_migrations WHERE version = 5;
EOF
```
Verify remaining schema integrity:
```bash
go test ./...
```

---

## 4. Background Process & Worker Termination

If an online streaming session or background worker is stuck:
```bash
# Terminate Python vision workers
pkill -f "services/vision"

# Terminate Go API server if needed
pkill -f "apps/api/cmd/api"
```
Verify all bounded queues have flushed and GPU/CPU resources are returned to idle.

---

## 5. Returning to Golden Replay Mode

If live video inference or demand profiles become unavailable:
1. Revert to standard synthetic scenario or pre-recorded golden replay in the UI Command Center.
2. The UI will display the **Cached Observations** or **Golden Replay** indicator.
3. Core C1-C6 aggregate simulation continues running independently of video stream status.
