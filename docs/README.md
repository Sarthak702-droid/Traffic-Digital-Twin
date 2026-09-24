# Project Documentation Directory

This directory contains specifications, architectural guides, delivery plans, and epic verification reports for the Traffic Digital Twin project.

---

## 1. Specifications & Core PRDs

- [`PRD.md`](./PRD.md) — Canonical Product Requirements Document (PRD) for the DGP Demonstration MVP.
- [`contracts-plan.md`](./contracts-plan.md) — Specification for the four decoupled system clocks, time semantics, and contract schemas (Task T02).
- [`architecture.md`](./architecture.md) — System architecture description: React frontend, Go API orchestrator/persistence, PostgreSQL, and private Python gRPC compute services.
- [`API-ARCHITECTURE-SPEC-ALIGNMENT.md`](./API-ARCHITECTURE-SPEC-ALIGNMENT.md) — Technical alignment notes resolving backend architecture decisions and authority boundaries.
- [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) — Implementation roadmap and engineering milestones for the functional prototype.
- [`prd_pack/`](./prd_pack/) — Complete PRD distribution pack including `Traffic_Digital_Twin_Agent_PRD_v1.0.1.md`, Word, PDF, checksums, and companion task definitions.

---

## 2. Planning & Delivery Tracking

- [`backlog.json`](./backlog.json) — Structured backlog definitions covering Epics 1 through 19 and their corresponding user stories.
- [`delivery-status.json`](./delivery-status.json) — Tracking registry mapping each backlog story and task to its verified evidence on disk.
- [`DELIVERY-PLAN.md`](./DELIVERY-PLAN.md) — Comprehensive workstream schedule and milestone delivery plan.
- [`REMEDIATION-STATUS.md`](./REMEDIATION-STATUS.md) — Review of identified gaps, mitigation status, and compliance gates.
- [`UX-PRODUCTION-AUDIT.md`](./UX-PRODUCTION-AUDIT.md) — Detailed user-experience and UI production audit.

---

## 3. Subdirectories

- [`epics/`](./epics/) — Acceptance criteria and implementation status reports for individual epics (`epic1-acceptance.md` through `epic14-status.md`).
- [`screenshots/`](./screenshots/) — Visual evidence captures across desktop and mobile layouts for verified epics.
- [`prd_pack/`](./prd_pack/) — Official distribution bundle containing versioned PRDs and execution companion templates.
