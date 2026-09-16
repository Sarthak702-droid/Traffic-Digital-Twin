# Implement Epic 1 foundation and shared contracts

The repository previously contained only planning artifacts. This change implements S01–S04: a configuration-driven Next.js network inspector, versioned Go/Python/TypeScript contracts, validated C1–C6 topology, and a chi/pgx API with transactional PostgreSQL persistence.

Preparing a scenario now saves its type, seed and mode together with an append-only audit entry. Records survive restart. The UI exposes node/phase inspection and saved run/audit history; simulation and recommendation execution explicitly remain unavailable until their owning epics.

The delivery dashboard reads versioned backlog and acceptance evidence, marks the four Epic 1 stories completed, and preserves personal tracking for other stories. Architecture and acceptance documentation explain the synthetic timing assumptions and scope boundaries.

Validation:
- Go race tests, including real PostgreSQL migration/durability/rollback checks and Go→Python gRPC validation.
- Eight Python boundary/schema tests; three UI unit tests; TypeScript checks and production build.
- Browser checks for keyboard drawer behavior, invalid seed rejection, all three prepared scenario types, persisted reload, audit, responsive layout and no page errors.
- Dashboard checks for all epic searches, four evidence-backed completions and evidence access.
- Regenerated shared artifacts match committed output.

Local demo only. No traffic simulation, trained ML, physical actuation or field calibration is claimed in Epic 1. See docs/epic1-acceptance.md for acceptance mapping and commands.
