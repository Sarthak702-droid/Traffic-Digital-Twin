# Traffic Digital Twin Known Limitations & Disclosures

Honest technical boundaries, hardware constraints, and domain disclosures. PRD §21, §26, §27.

---

## 1. Hardware & GPU Compatibility

1. **NVIDIA GeForce MX230 (Pascal Compute Capability 6.1)**:
   - The host system contains an NVIDIA MX230 with 4096 MiB VRAM.
   - The active PyTorch wheel (`torch==2.13.0+cu130`) only includes CUDA compute kernels for architectures $\ge$ `sm_75` (Turing, Ampere, Ada, Hopper).
   - PyTorch therefore operates strictly on the host CPU (`device='cpu'`) with 4 threads.
   - **Performance Impact**: Single-frame detector latency is ~2800 ms (~0.35 FPS).
2. **Concurrent Streaming Bottleneck**:
   - Sustaining 12 concurrent camera streams at 8 FPS requires ~96 aggregate FPS, which exceeds CPU thread capacity.
   - On the target host CPU, concurrent inference achieves ~0.28-0.35 FPS per camera.
   - **Recommended Mode**: The system provides **Cached Observation Mode** for smooth, zero-latency demos and analysis.
   - **Production Remedy**: Deploying on a discrete GPU with `sm_75+` (e.g. RTX 3080/4090, T4, A100) or TensorRT FP16 compilation enables full real-time multi-stream performance.

---

## 2. Dataset & Video Footage Disclosures

1. **Sample Traffic Footage**:
   - The 12 accessible video clips are public sample recordings of Indian urban traffic (Mumbai, crossroads).
   - They do not represent a calibrated, physical sensor array in Bhubaneswar.
   - Virtual camera assignments (`CAM-01` through `CAM-06` to C1-C6 topology) are declared demonstration mappings.
2. **Independent Accuracy Gate**:
   - Because no human-annotated ground-truth bounding boxes exist for these 12 clips, independent crossing accuracy (WAPE / signed bias) is truthfully marked:
     `BLOCKED_WITHOUT_INDEPENDENT_GROUND_TRUTH`.
   - Agent self-agreement (comparing ByteTrack against model detections) is used for pipeline verification, but is never misrepresented as third-party certified accuracy.

---

## 3. Metric Availability & Non-Fabrication

1. **Uncalibrated Speed is Unavailable**:
   - 2D monocular perspective video without survey-grade ground camera calibration cannot authoritatively measure vehicle speed in km/h.
   - Per PRD §8.5 & §19.3, speed is explicitly marked `UNAVAILABLE` across all contracts, API responses, and UI elements. No artificial default (e.g. "45 km/h") is fabricated.
2. **Modeled Queue vs. Camera Visible Queue**:
   - The camera visible queue is bounded by the camera's field of view (ROI polygon).
   - The network model's link queue represents total stored mass across the entire link length. The frontend differentiates between the two.

---

## 4. Operational Boundaries

1. **Virtual Control Actuation**:
   - The signal recommendation system produces virtual phase adjustments for simulation and evaluation.
   - It is not connected to physical municipal traffic controllers or field hardware.
2. **Emergency Vehicle Corridors**:
   - Emergency corridor prioritization and C3 incident simulations are modeled scenario events, not automated detections from stock video footage.
