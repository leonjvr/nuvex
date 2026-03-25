# Known Limitations (v0.9.7)

This document lists intentional constraints, deferred features, and design
trade-offs that are acknowledged but not fixed in the current release.
Each entry includes a mitigation strategy and the planned fix version.

---

## Single API Key Authentication (#453)

The REST API currently uses a single shared API key for all clients.

**Impact:**
- All API consumers share the same authentication token.
- Audit logs record actions but cannot attribute them to specific users or services.
- Key compromise requires rotating the single key for every consumer simultaneously.

**Mitigation:** Deploy the API behind a reverse proxy (nginx, Caddy, Traefik) that
provides per-client authentication, rate limiting, and audit logging before
requests reach SIDJUA.

**Planned fix:** Per-client API tokens with RBAC scopes in V1.0.

---

## In-Process Rate Limiter (#455)

The HTTP rate limiter stores token buckets in process memory only.

**Impact:**
- Limits do not persist across restarts.
- In a multi-process deployment each process maintains an independent counter,
  allowing clients to exceed the intended rate by spawning concurrent connections.

**Mitigation:** Run a single API server process behind a load balancer. Use the
reverse proxy layer for cluster-wide rate limiting.

**Planned fix:** Optional Redis/SQLite-backed rate limiter in V1.0.

---

## Log Tailing Uses Polling (#468)

`sidjua logs --follow` polls the database every 2 seconds (5 seconds when idle)
rather than using a push-based mechanism.

**Impact:**
- Slight delay (up to 5 seconds) before new log entries appear in follow mode.
- Unnecessary DB reads during quiet periods, even with adaptive backoff.

**Mitigation:** Acceptable for operational log tailing. For real-time event
streaming, use the SSE endpoint at `GET /api/v1/events`.

**Planned fix:** Replace polling with SSE subscription in V1.0.

---

## SQLite Single-Writer Concurrency

SIDJUA uses SQLite in WAL mode, which supports concurrent reads but serialises
writes. Under high task throughput, write-heavy operations may queue.

**Impact:** May cause latency spikes when many agents submit results simultaneously.

**Mitigation:** Tune `busy_timeout`; the default is 30 seconds, which handles
typical bursts. For throughput beyond ~100 concurrent agents, consider sharding
by division.

**Planned fix:** PostgreSQL adapter in V2.0 Enterprise.
