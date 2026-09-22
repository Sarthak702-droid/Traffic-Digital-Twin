# Traffic Digital Twin - Agent PRD package

**Prepared 22 September 2026.** This is a requirements and execution package, not a patch to the GitHub repository. No model weights, raw videos, dependencies or application implementation are included.

**Update v1.0.1:** ITD v1.2 is already downloaded (owner-confirmed). The agent must locate, verify and reuse that checkpoint; no default model redownload. File access and compatibility remain to be checked.

## Files

- `Traffic_Digital_Twin_Agent_PRD_v1.0.1.md`: canonical detailed PRD, decision resolutions, sources, requirements and acceptance gates.
- Matching `.docx` and `.pdf`: readable/editable copies of the same PRD.
- `AGENT_START_HERE.md`: kickoff instructions for Codex/Antigravity or another capable local agent.
- `agent_tasks.json`: 18 dependency-ordered tasks, all initially NOT_STARTED.
- `source_registry.json`: pinned repository and official tool/download references with verification status.
- `templates/`: unresolved input, clip, geometry and readiness templates; not runtime configuration yet.
- `checksums.sha256`: file checksums for the final package.

## Use

Give the package and access to the existing repository to the coding agent. Start with `AGENT_START_HERE.md`. Grant only the required media/model directories. Let the agent populate templates, discover hardware, validate the checkpoint, freeze contracts and execute the task graph. Do not manually run the proposed `scripts/twin.py` commands before the agent has implemented them.

No need to buy another dataset, train a detector from scratch or subscribe to both coding tools by default. Permissions, license acceptance, paid actions and release authority remain explicit. Agent-only review can support a labeled engineering demo; it must not be reported as independent real-world accuracy validation.
