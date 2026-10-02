# Traffic Digital Twin: local prototype runbook

This runbook operates the Go API, PostgreSQL, Python gRPC compute services, and Vite browser on one workstation. It exercises virtual control only. The target machine and supported concurrency remain to be established by P01/Q01 measurements.

## Prepare the workstation

1. Use Python 3.12, Go, Node.js, Docker Compose and the checked-in `go.sum`, `package-lock.json`, `services/requirements.lock`, and `services/vision/requirements.lock`. Keep `.venv`, `.runtime`, source MP4 files and model weights out of git. Run `python3 scripts/twin.py doctor --config reports/agent-config.json` to inspect local dependencies.
2. Place only footage you are authorized to process under a local authorized root. The default media directory for the asset verifier, launcher and Go playback route is the ignored `traffic video/` directory at the repository root; set `VIDEO_ASSET_DIR` to another authorized directory if needed. Preserve the original recording. Record the license or written authorization reference separately; the processing command requires that reference. `reports/asset-manifest.json` declares registered filenames, dimensions, lengths, byte sizes and SHA-256 digests. Run `python3 scripts/twin.py assets --config reports/agent-config.json` from the repository root to verify every staged clip's complete size and digest. A missing or mismatched clip fails the check.
3. Put the private ITD v1.2 checkpoint at the configured `.runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt` path. Run `python3 scripts/twin.py model-check --config reports/agent-config.json` to verify its digest. Do not put the checkpoint or private signing material in git or a customer package.
4. Create the local Python environment and install the locked dependencies. Install root/web Node dependencies with `npm ci` and download Go modules using the checked-in `go.sum`. Keep the command output and versions with the run record. The launcher uses `node_modules/.bin/vite` from the root or web workspace; its npm fallback runs from the repository root.
5. Start PostgreSQL with `docker compose up -d postgres`. Do not use `down -v` on the shared local database. Run `python3 scripts/bootstrap-local.py` to create private local settings, then provision an operator with `python3 scripts/create-gateway-user.py .runtime/gateway-users.json <username> --role operator`; the script prompts for a password without placing it in shell arguments. Keep the account file private.

## Process a registered clip

Check `packages/camera-config/cameras.json` for the registered camera, counting line, queue region and declared virtual boundary. Process an authorized clip with:

```bash
.venv/bin/python scripts/process-recorded-clip.py \
  --camera CAM-01 \
  --clip /absolute/authorized/root/registered-file.mp4 \
  --authorized-root /absolute/authorized/root \
  --authorization-reference <local-rights-record-id>
```

The output under `.runtime/vision/processed` identifies the clip/config/model/source session and finalized windows. A valid zero crossing remains a zero, and a window is usable only after its end and processing completion. A cached entry may be reused only when its complete identity matches. The original media remains immutable. For a video-derived run, the configured boundary cameras need matching processed inputs; start with one freshly processed camera and already validated cached inputs for the others. Independent clips are declared virtual demand, not a measured physical corridor.
The processor admits one job at a time for each processed-output directory. If another job owns that directory's inference slot, retry after it finishes. On Linux, `--cpu-core-limit` defaults to four available logical CPUs and binds the process before detector/decoder imports; use a separately frozen machine budget before changing it. Additional fresh-video capacity has not been established.

## Operate the virtual run

1. Run `npm start` from the repository root. It starts PostgreSQL if needed, Python simulation/intelligence gRPC, Go API on `127.0.0.1:8081`, and Vite on `127.0.0.1:3100`. The Go API is the only command path. Use the browser login; viewer mutations must fail.
2. Open **Vision Analytics** and inspect registered clip status, finalized window timing, provenance and data quality. Its continuous looping and play/pause change display time only. They do not repeat observations or change a run's authoritative input. Missing or degraded data is unavailable; exhausted authoritative input disables forecasts even while the display loops.
3. Select a graph, scenario and demand source. The original two-controlled-junction graph and synthetic three-controlled-junction graph, plus peak, incident and emergency scenarios, require separate verification. In Recommend mode inspect source video time, latest completed observation window, virtual simulation time, forecast origin and input quality together. The 30/60/120/300-second forecast horizons may be unavailable when evidence is insufficient.
4. Inspect current and candidate plans over the same window and demand assumptions. Compare modeled queue delay (veh·s), boundary exits (veh), waiting-to-enter backlog (veh) and worst service debt (s). `no_action` calls for no timing change; `cannot_evaluate` signals unsuitable input or compute. Individual stops, journey time, and uncalibrated video speed are unavailable.
5. Use **Pause virtual clock for review**, then wait for fresh analysis of the held snapshot before simulating, approving, modifying with a reason, or rejecting with a reason. Use **Resume virtual clock** after approval so the accepted plan can reach its safe activation boundary. Confirm a later `virtual_plan_applied` audit with the virtual tick and changed signal state. Clock commands are authenticated, idempotent and audited. On stale input, timeout, dependency loss or uncertain command outcome, inspect the command and audit before retrying. Replay is an explicit labeled operator action.
6. In **Audit & Health → Run history**, click **Export report**. Go downloads `prototype-run-report-v2` with chronological aggregate observations/analyses, matched alternatives, server-derived decision actors, applied outcomes, failures and measured resources. Unmeasured values remain null with a reason. Seeded runs have no source-video origin. Export survives a restart and excludes media, individual tracking identities and credentials. A full simulator restart ends its interrupted in-memory run; start a new run rather than resubmitting an old approval.

Approval and modification require a fresh private comparison and an exact held snapshot. Go forwards the recommendation's earliest activation time, source epoch and snapshot sequence; the simulator checks them atomically before accepting a new command. A changed snapshot requires fresh analysis. Accepted command recovery queries the exact durable dispatch payload and never repeats actuation.

## Diagnostic evidence and human acceptance

The current repair evidence is in `docs/handoffs/Q01-acceptance-repair.md`. For this i7 workstation, serialized compute probes use `scripts/benchmark_compute.py --protocol packages/scenario-config/prototype-resource-budget-i7-v2.json --mode <simulation|candidate_evaluation> --output <private-output.json>`. The original workstation protocol remains unchanged and a mismatched machine is rejected.

`scripts/evaluate_synthetic_forecasts.py --protocol packages/scenario-config/synthetic-forecast-tuning-v1.json --output <private-output.json>` evaluates bounded past-only synthetic traces against persistence. The active forecaster is already boundary-local, so its local-only comparator is explicitly identical. Emergency tuning uses `prototype-evaluation-v2-tuning-diagnostics.json`; recovery may be censored and route flow is aggregate traffic, not ambulance travel time. These tuning protocols cannot pass acceptance gates or replace frozen v1 results.

Use `scripts/prepare-reference-review.py` to prepare detector-free review material under an ignored private directory. Two distinct human reviews and adjudication are still required by `docs/reference-labeling-protocol.md`; detector output cannot fill those forms. A non-implementing operator must separately rehearse reserved input. Do not describe the prototype as accepted before those records and the remaining benchmark, age and latency gates pass.

## Network configuration upgrades

Network config IDs identify immutable definitions in PostgreSQL. The current two-junction definition is `c1-c6-v5`; it versions the camera boundary mappings and explicit incident location added after the original `c1-c6-v4`. Startup inserts v5 alongside existing versions and keeps historical runs bound to their original configs. Restarting with the same definition is idempotent.

When changing a persisted network definition, assign a new config ID before starting the stack. A `config ... already exists with different content` error indicates an ID was reused; compare the definitions and version the changed configuration. Preserve the existing database and audit history. Config hashes change with the new definition, so process recorded inputs again before using them with the revised graph. Regenerate synthetic replay assets with `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python scripts/record-replay.py`, then run the same command with `--write-manifest`. Manifest generation checks every frame's config hash and simulator version before writing checksums.

## Verification and evidence

Run focused suites and contract checks after a change: `go test ./...` under `apps/api`, `.venv/bin/python -m pytest -q services`, `npm test -- --run` under `apps/web`, and `python3 scripts/verify-contracts.py`. Go/PostgreSQL tests need the local database. Mock-backed tests do not establish real OpenCV/gRPC/browser acceptance.

P01/Q01 must record fresh-video processing time, inference throughput, simulation and candidate evaluation time separately, including CPU, peak RAM, input age and state-to-recommendation latency. Declare hardware, source intervals, input identities, workload, candidate budget, supported concurrency, failures and raw commands. Freeze benchmark inputs and thresholds before held-out evaluation. Q01 must have an independent operator process a reserved clip without developer edits. Current evidence and remaining checks are in `docs/PROTOTYPE-GATES-Q01.md` and `reports/readiness.json`; historical delivery percentages do not close gates.

For a developer integration rehearsal, start an isolated stack with the desired `NETWORK_CONFIG` and `VIDEO_PROCESSED_DIR`, then run:

```bash
.venv/bin/python scripts/rehearse_prototype.py \
  --username <provisioned-operator> \
  --network-config packages/scenario-config/c1-c6.json \
  --output-dir .runtime/rehearsal/two-junctions
```

The command prompts for the password and starts/replaces three virtual runs through Go. Use `--api` and `--origin` for isolated ports. Repeat with `three-controlled-junctions.json` and a stack running that graph; its recorded inputs must be freshly processed against the same graph hash. Reports are written locally. The timing sample covers the clock request through receipt of exact held-snapshot analysis, including HTTP/database/cadence; it does not establish continuous-run p95. This automation does not replace the non-implementer reserved-input check or a predefined accuracy/control benchmark.
