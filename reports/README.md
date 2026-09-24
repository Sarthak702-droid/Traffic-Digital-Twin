# Verification Reports & Artifacts Registry

This directory contains the audit reports, benchmark measurements, manifests, and execution evidence generated during system verification and PRD qualification.

---

## 1. Environment & Configuration

| File | Description |
| :--- | :--- |
| [`agent-config.json`](./agent-config.json) | Operational parameters, asset paths, and verification policies for the twin management CLI. |
| [`environment.json`](./environment.json) | Hardware capabilities, GPU compute status, runtime versions, and system snapshot. |

---

## 2. Readiness & Planning

| File | Description |
| :--- | :--- |
| [`readiness.json`](./readiness.json) | Release gate evaluation matrix covering tasks T01–T17 and operational readiness criteria. |
| [`baseline-status.json`](./baseline-status.json) | Baseline commit hash, repository state, and tracked vs untracked asset discovery. |
| [`blockers.json`](./blockers.json) | Explicit tracking of field-pilot constraints, GPU limitations, and commercial licensing boundaries. |
| [`test-plan.json`](./test-plan.json) | Comprehensive test matrix for contracts, simulation invariants, vision, and UI. |

---

## 3. Data Manifests & Provenance

| File | Description |
| :--- | :--- |
| [`asset-manifest.json`](./asset-manifest.json) | Inventory of recorded video clips, hashes, resolutions, durations, and camera slot assignments. |
| [`demand-profile-manifest.json`](./demand-profile-manifest.json) | Video-derived boundary inflow profiles used by the aggregate simulation engine. |
| [`observation-manifest.json`](./observation-manifest.json) | Partitioned 5-second finalized observation files, event counts, and checksums. |
| [`downloads.lock.json`](./downloads.lock.json) | Cryptographic hash locks for the ITD v1.2 YOLO checkpoint and asset provenance. |
| [`annotation-provenance.json`](./annotation-provenance.json) | Auto-annotation reference frame samples, bounding boxes, and label provenance. |
| [`screenshots-manifest.json`](./screenshots-manifest.json) | Catalog of evidence screenshots demonstrating UI verification modes. |

---

## 4. Test & Verification Reports

| File | Description | Primary Verification Target |
| :--- | :--- | :--- |
| [`api-contract-report.json`](./api-contract-report.json) | OpenAPI, endpoint ownership, and Protobuf schema alignment. | Go API Gateway (T12) |
| [`benchmark-report.json`](./benchmark-report.json) | Target machine inference latency, throughput, and memory consumption. | Vision Benchmark (T16) |
| [`candidate-test-report.json`](./candidate-test-report.json) | Evaluation of candidate signal plans against the current baseline. | Decision Engine (T11) |
| [`causality-report.json`](./causality-report.json) | Verification of four decoupled clocks and non-anticipating forecasts. | Time Semantics (T02) |
| [`concurrency-test-report.json`](./concurrency-test-report.json) | Parallel 12-camera ingestion with backpressure and bounded queues. | Orchestrator (T07) |
| [`conservation-test-report.json`](./conservation-test-report.json) | Mass balance and finite-capacity conservation in C1–C6 network. | Simulation Engine (T08) |
| [`demand-conservation-report.json`](./demand-conservation-report.json) | Conservation from video observations to simulation boundary mass. | Demand Inflow (T10) |
| [`forecast-report.json`](./forecast-report.json) | Horizon accuracy metrics (+30s, +1m, +2m, +5m) across traffic states. | Causal Forecast (T11) |
| [`geometry-review.json`](./geometry-review.json) | Detection segments, counting directions, and network junction mappings. | Camera Geometry (T05) |
| [`integration-test-report.json`](./integration-test-report.json) | End-to-end integration test execution across normal and surge scenarios. | Integration (T15) |
| [`media-review.json`](./media-review.json) | Visual inspection of input video quality, artifacts, and camera views. | Video Corpus (T04) |
| [`migration-test-report.json`](./migration-test-report.json) | PostgreSQL migration and rollback test execution. | Database (T12) |
| [`model-report.json`](./model-report.json) | ITD v1.2 YOLO model architecture, weights hash, and 8-class detection map. | Model Ingestion (T03) |
| [`reference-quality-report.json`](./reference-quality-report.json) | Evaluation of detector predictions against reviewed reference frames. | Auto-Annotation (T14) |
| [`snapshot-equivalence-report.json`](./snapshot-equivalence-report.json) | Deterministic state snapshotting, sanitization, and replay parity. | State Engine (T09) |
| [`ui-test-report.json`](./ui-test-report.json) | Frontend test suite results for UI panels, canvas, and controls. | Web Frontend (T13) |
| [`vision-test-report.json`](./vision-test-report.json) | Unit tests for ITD inference, tracking, and observation binning. | Vision Pipeline (T06) |
