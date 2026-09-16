# Versioned contracts

`proto/twin.proto` is the authoritative Go/Python wire model. `typescript/events.ts` and `events.schema.json` are generated from its descriptor. JSON uses snake_case fields; protobuf int64/uint64 values use strings in JSON to preserve precision. REST network types are in `typescript/network.ts`. All rates use vehicles/minute, queues/capacity vehicles, distances metres, speed km/h, occupancy 0–1 and durations seconds.

WebSocket JSON envelopes use `schema_version`, `sequence` (per connection), RFC3339 `timestamp`, `type` and typed `payload`. Exactly the nine PRD event types are modelled. Epic 1 emits `health.updated`; other producers arrive in their owning epics. Reconnect resets sequence: do not interpret it as a durable audit cursor. Audit REST pagination uses its separate database sequence.

Regenerate with `scripts/generate-contracts.sh`. Tools: protoc-gen-go v1.36.12, protoc-gen-go-grpc v1.6.2 and the Python versions in `services/requirements.lock`. SQL bindings: sqlc v1.30.0, `sqlc generate`.

RPCs ValidateState are functional on both Python service boundaries. Reset/GetState/Predict are declared but deliberately UNIMPLEMENTED; this foundation must not imply simulation or forecasting is implemented. `apps/api/internal/contracts` and `services/shared/validation.py` enforce payload semantics. The integration test sends both valid and invalid state from generated Go clients into the Python server.
