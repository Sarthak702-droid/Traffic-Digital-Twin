# Backend and API architecture alignment

This repository follows the supplied Backend Architecture Service Specification and API Concepts Backend Interface Specification dated 2026-09-18.

## Architecture

The public path is Browser to Go API gateway to Go domain modules and PostgreSQL. Python simulation and intelligence services are private gRPC dependencies. Go owns HTTP and WebSocket delivery, validation, correlation IDs, authorization, safety, persistence, audit, health aggregation, and error normalization. Python returns typed computation results and has no database credentials or public HTTP role.

Persistence is an in-process Go module using pgx and sqlc. Transactions commit coupled recommendation, operator action, and audit records together. The module is deliberately separable but is not deployed as a DB-writer microservice for this MVP.

## API contract

Public REST endpoints use `/api/v1`; live events use `/ws/v1/live`. REST handles commands and request-response queries. WebSocket is a typed, one-connection-per-client operational stream and is never the authoritative command channel. Go to Python calls use versioned Protobuf/gRPC requests with correlation ID, state version, deadline, and scenario identity where relevant.

State-changing commands use `Idempotency-Key`. The Go persistence layer records command identity and payload hash so equivalent retries return the recorded result and changed-payload retries conflict. API responses include `X-Request-ID`, errors use a stable `code` and `message` envelope, and `/health/live` plus `/health/ready` distinguish process liveness from readiness.

## MVP exclusions

Do not add a Python HTTP gateway, a separately deployed Go DB writer, Kafka, Redis, Kubernetes, service mesh, OAuth/OIDC, or arbitrary direct database access. Do not connect to physical signals or Odisha CCTV. No Python service can authorize, persist, or expose an actionable operator decision.
