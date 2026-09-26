# Traffic Digital Twin: current prototype limits

## Resource capacity

The 2026-09-25 P01 probe on an Intel Core Ultra 9 285H workstation with 16 logical CPUs and 30 GiB RAM processed one authorized CAM-01 clip over source time `[0,15)` seconds using real OpenCV/ITD detection and tracking. It produced three valid finalized five-second windows. The complete job took 14.61 s wall time, averaged 430% CPU and peaked at about 1.61 GiB resident memory. That measurement includes model load, decode, inference, tracking and finalization; it is not an isolated inference or state-to-recommendation latency. The final target machine is not yet declared. No multi-camera throughput, 2–5-second recommendation deadline or live RTSP capacity is claimed.

The legacy concurrent orchestrator has a four-frame-per-camera input queue and drops frames under backpressure. Its older 12-stream assumptions and cached-demo throughput do not establish supported operating concurrency. S03 limits candidate analysis to five plans including current, one in-flight analysis per process and a 1.5-second internal deadline, but that budget is a protective setting rather than measured target-machine capacity. P01/Q01 must measure fresh-video inference, simulation and candidate evaluation separately and disclose input age, CPU/RAM and missed deadlines.

## Recorded input and reference quality

`reports/asset-manifest.json` lists twelve registered sample clips. The manifest and static telemetry are inventory, not proof that every local file is present or that twelve streams can be processed together. `python3 scripts/twin.py assets --config agent-config.json` verifies staged file size and complete SHA-256 digest in the ignored `traffic video/` directory, or `VIDEO_ASSET_DIR` when set. Source clips and the private detector checkpoint remain outside git. Use only footage with a recorded authorization reference. Independent recordings mapped to virtual boundary directions are not synchronized measurements of a physical corridor.

V02 has selected candidate ordinary, crowded and difficult windows, but independent labels still require a second reviewer. Detector output cannot serve as its own ground truth. Crossing accuracy, visible-queue error and uncertainty calibration remain unavailable until reviewed labels and held-out evaluation exist. Visible camera queue is a region-limited estimate. Video speed in km/h is unavailable without physical calibration; a modeled link speed is a separate synthetic state metric.

## Control, evidence and field scope

Only the finite-capacity aggregate virtual network is controlled. No physical signal controller, live CCTV/RTSP, municipal comparison, field calibration or production deployment is connected. An approved plan must be seen to change later virtual signal state at a safe boundary and leave a terminal applied/rejected audit receipt. The U01 live browser smoke covered a seeded peak run and source/status display, not recorded-video processing or an approved plan. Exact snapshot binding can make recommendations short-lived as the one-second virtual engine advances; Q01 must test the operator approval journey under real timing.

The 30/60/120/300-second forecast horizons may be unavailable on short or stale clips. Individual stops and journey time are unavailable. A lower central queue with higher boundary backlog or side-road service debt is not an unconditional improvement. E01/E02 must freeze reference splits, baselines, thresholds, synthetic seeds and tolerated regressions before held-out evaluation. P02 report export and independent-operator Q01 rehearsal remain open. These are engineering prototype limits; physical field benefit belongs to a later phase.
