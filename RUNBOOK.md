# Traffic Digital Twin: local prototype runbook

This runbook operates the Go API, PostgreSQL, Python gRPC compute services, and Vite browser on one workstation. It exercises virtual control only. The target machine and supported concurrency remain to be established by P01/Q01 measurements.

## Prepare the workstation

1. Use Python 3.12, Go, Node.js, Docker Compose and the checked-in `go.sum`, `package-lock.json`, `services/requirements.lock`, and `services/vision/requirements.lock`. Keep `.venv`, `.runtime`, source MP4 files and model weights out of git. Run `python3 scripts/twin.py doctor --config agent-config.json` to inspect local dependencies.
2. Place only footage you are authorized to process under a local authorized root. The default media directory for the asset verifier, launcher and Go playback route is the ignored `traffic video/` directory at the repository root; set `VIDEO_ASSET_DIR` to another authorized directory if needed. Preserve the original recording. Record the license or written authorization reference separately; the processing command requires that reference. `reports/asset-manifest.json` declares registered filenames, dimensions, lengths, byte sizes and SHA-256 digests. Run `python3 scripts/twin.py assets --config agent-config.json` from the repository root to verify every staged clip's complete size and digest. A missing or mismatched clip fails the check.
3. Put the private ITD v1.2 checkpoint at the configured `.runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt` path. Run `python3 scripts/twin.py model-check --config agent-config.json` to verify its digest. Do not put the checkpoint or private signing material in git or a customer package.
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
The processor admits one job at a time for each processed-output directory. If another job owns that directory's inference slot, retry after it finishes; concurrent fresh-video capacity has not been measured or declared.

## Operate the virtual run

1. Run `npm start` from the repository root. It starts PostgreSQL if needed, Python simulation/intelligence gRPC, Go API on `127.0.0.1:8081`, and Vite on `127.0.0.1:3100`. The Go API is the only command path. Use the browser login; viewer mutations must fail.
2. Open **Vision Analytics** and inspect registered clip status, finalized window timing, provenance and data quality. Its play/pause/seek changes display time only. It does not change a run's authoritative input. Missing or degraded data is unavailable, and playback stops at end of file.
3. Select a graph, scenario and demand source. The original two-controlled-junction graph and synthetic three-controlled-junction graph, plus peak, incident and emergency scenarios, require separate verification. In Recommend mode inspect source video time, latest completed observation window, virtual simulation time, forecast origin and input quality together. The 30/60/120/300-second forecast horizons may be unavailable when evidence is insufficient.
4. Inspect current and candidate plans over the same window and demand assumptions. Compare modeled queue delay (veh·s), boundary exits (veh), waiting-to-enter backlog (veh) and worst service debt (s). `no_action` calls for no timing change; `cannot_evaluate` signals unsuitable input or compute. Individual stops, journey time, and uncalibrated video speed are unavailable.
5. An authenticated operator may simulate, approve, modify with a reason, or reject with a reason. An accepted plan waits for a safe virtual boundary. Confirm a later `virtual_plan_applied` audit with the virtual tick and changed signal state. On stale input, timeout, dependency loss or uncertain command outcome, inspect the command and audit before retrying. Replay is an explicit labeled operator action.

## Verification and evidence

Run focused suites and contract checks after a change: `go test ./...` under `apps/api`, `.venv/bin/python -m pytest -q services`, `npm test -- --run` under `apps/web`, and `python3 scripts/verify-contracts.py`. Go/PostgreSQL tests need the local database. Mock-backed tests do not establish real OpenCV/gRPC/browser acceptance.

P01 must record fresh-video processing time, inference throughput, simulation and candidate evaluation time separately, including CPU, peak RAM, input age and state-to-recommendation latency. Declare hardware, source intervals, input identities, workload, candidate budget, supported concurrency, failures and raw commands. Freeze benchmark inputs and thresholds before held-out evaluation. Q01 must repeat the complete Go/PostgreSQL/Python/browser path and have an independent operator process a reserved clip without developer edits. P02 will add one-action authenticated report export; until then, preserve audit and test artifacts separately and mark that gate open.
