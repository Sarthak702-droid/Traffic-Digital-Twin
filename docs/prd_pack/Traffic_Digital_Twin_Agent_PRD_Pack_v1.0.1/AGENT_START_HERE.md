# Agent kickoff: Traffic Digital Twin

Read `Traffic_Digital_Twin_Agent_PRD_v1.0.1.md` as the canonical specification and `agent_tasks.json` as the dependency plan. This package is a specification, not a completed implementation or runnable traffic pipeline. Required CLI names in the PRD are targets to implement and test.

## Mission

Build the requested ITD-powered video analytics and predictive aggregate demo in the existing `Sarthak702-droid/Traffic-Digital-Twin` repository. Use the owner's existing twelve videos and already-downloaded ITD v1.2 checkpoint. Preserve Go public/API/persistence ownership, Python private compute, C1-C6 topology, current operator workflow and removal of SUMO.

Deliver both cached-observation playback with active virtual simulation and concurrent online inference on recorded videos. Do not satisfy the concurrent requirement by silently replacing inference with cached results. Every performance/accuracy/readiness claim requires actual evidence.

## Confirmed model asset

ITD v1.2 pretrained model is already downloaded (owner-confirmed). The agent MUST locate and reuse the existing checkpoint; no model download by default. Filename/path, format, SHA-256, class mapping and runtime compatibility remain unverified. If inaccessible, request only its path/access. Redownload or replacement needs explicit owner authorization.

## First execution

1. Resolve execution HEAD, inspect dirty work, actual instruction files and launch/test manifests. Do not reset to the reference commit or overwrite owner changes.
2. Read PRD Sections 1-8. Discover hardware and accessible assets in authorized directories. Ask only for genuine non-resolvable path/permission/account/budget prerequisites, preferably in one bundled request.
3. Create a feature branch/worktree, baseline report and evidence directory. Run existing tests that the environment supports; record failures and skipped integrations honestly.
4. Generate configuration from `templates/agent-config.example.json`. Empty roots and null paths are unresolved placeholders, not authorization to search an entire computer.
5. Freeze source-time, observation, demand and snapshot contracts before parallel coding. Resolve package versions against the actual checkpoint, platform and official documentation, then pin the tested solution.

## Autonomous work policy

You own implementation, downloads within the permitted scope, setup, geometry proposals, pre-annotation, test construction, execution, reports and packaging. Do not assign routine coding or box drawing to the owner as the default path. Agent-reviewed geometry and labels may support a disclosed provisional engineering demo, but they are not independent ground truth. If an input cannot be established, choose a supported degraded/blocked state rather than invent it.

Owner authorization is still required for account/license acceptance, paid resources, external footage upload, driver changes, raw-asset deletion, main-branch push and public release. Never impersonate the owner or fabricate approval. If model-use rights are unresolved, continue code/fixture work and record the specific inference/use blocker.

## Runtime invariants

- Load the exact trusted ITD model and actual class mapping; no hidden generic model download or substitution.
- Explicit ByteTrack selection; separate state per camera/session; one detector inference owner per GPU initially.
- Decode/detect/track/count dependencies stay ordered within a camera; cameras and independent forecasts overlap.
- Camera geometry is versioned configuration. No invented metre scale, measured speed or real geographical connectivity.
- Source timestamp, not wall-clock processing time, determines flow measurement.
- Aggregate observations contain identity, window, provenance, quality and versions. Missing is not zero.
- Use four external boundary demand roles only. Internal-link sample observations never add extra model traffic.
- Finalized five-second bins are causally released after availability; delayed-uniform input conserves their mass. No future cached bins in predictor input.
- Complete private physical/signal/backlog snapshot drives forecasts; restart data and hidden scenario schedule remain separate.
- Preserve finite storage, shared receiving capacity, strict-FIFO behavior and full mass conservation. No clamps to conceal errors.
- Forecast baseline is persistence, default EWMA after warm-up; damped Holt only after valid evidence. No LLM numeric controller.
- Plan changes are virtual and authorized; a recorded MP4 never changes because of a signal recommendation.

## Workstreams

Lead owns schemas and merges. Vision owns ITD/ByteTrack/media/geometry/counts/concurrency. Dynamics owns demand/CTM/snapshot/forecast. API/UI owns actual MP4 and source-aware views through Go. QA owns invariant, negative-case, integration and target-machine benchmark evidence. Use isolated branches/worktrees and a single shared-GPU benchmark lease.

Execute T01-T17 in dependency order. T18 is conditional and must not distract from core integration. Do not add Kafka, Redis, Kubernetes, RL/GNN, new training datasets or a public Python API. A separately approved CVAT development installation may have its own tool dependencies; those do not become traffic-runtime dependencies.

## Evidence and completion

Preserve real commands, exit codes, logs, hashes, measured per-camera throughput/lag, skipped tests, count-reference provenance and known limitations. Never weaken test assertions solely to get a pass. Twelve short clips looped for load testing are not twelve independent forecast histories.

Deliver source changes, regenerated contracts, migrations, tested locks, observation/profile artifacts where rights permit, `RUNBOOK.md`, `ROLLBACK.md`, `KNOWN_LIMITATIONS.md` and a readiness matrix with separate engineering/concurrency/realtime-12/independent-accuracy/commercial-rights labels. `NOT_RUN`, `BLOCKED` and `FAIL` are valid statuses; invented PASS is not.

## Suggested initial agent message

"I will inspect the repository and accessible assets, record the baseline and environment, and execute T01-T17 from the attached PRD. I will implement and test the pipeline rather than stop after planning. I will preserve current architecture, report evidence for every completed task, and request authorization only for genuinely blocked or restricted actions."
