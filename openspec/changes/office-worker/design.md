## Context

NUVEX runs as a Docker Compose stack. The brain container handles LangGraph execution. Today there are gateway containers for each channel (WhatsApp, Telegram, Email). The pattern is: each concern is its own container with a simple HTTP API. `office-worker` follows the same pattern.

LibreOffice headless runs as a subprocess invoked via Python's `subprocess.run`. It does not expose a socket server in this design — each request invokes `soffice --headless` for the operation and exits. This is stateless, crash-safe, and trivially parallelisable. TeX Live's `pdflatex` or `lualatex` is invoked the same way.

File I/O uses Docker volumes: the brain mounts `/data/files/` and office-worker mounts the same volume. Alternatively, files can be sent as multipart uploads — both modes are supported and the spec covers both.

## Goals / Non-Goals

**Goals:**
- Read document content: paragraphs, tables, tracked changes (as structured list), reviewer comments, named styles
- Write/create documents with tables, styles, headers/footers, images
- Accept-all / reject-all tracked changes as a discrete operation
- Convert: docx→pdf, xlsx→pdf, pptx→pdf, xlsx→csv, any→pdf via LibreOffice
- Compile LaTeX source → PDF; return error log on compilation failure
- Accept files as multipart upload or as a shared volume path
- Return 50 MB file size limit with a clear 413 error

**Non-Goals:**
- Running LibreOffice as a persistent socket server (adds complexity, unreliable with headless)
- OCR on scanned PDFs (separate concern)
- Real-time collaborative editing
- Macro execution inside documents (security risk; LibreOffice macros are disabled in headless mode)
- DOCX template engines (mail-merge style) — deferred to v2

## Decisions

### D1 — LibreOffice headless subprocess per request, not a socket server

**Decision:** Each HTTP request spawns `soffice --headless --norestore -- <args>` and waits for exit. No persistent LibreOffice process.

**Rationale:** LibreOffice headless is known to leak memory and hang in long-running socket server mode. Subprocess-per-request is less efficient but reliable and stateless. For NUVEX workloads (documents processed on agent instruction, not continuously), latency of ~1–3 seconds per operation is acceptable.

**Alternative considered:** `python-libreoffice` UNO bridge. Rejected — requires a running LibreOffice instance, complex to manage in Docker, known stability issues.

### D2 — Python `unoconv` wrapper vs. direct `soffice` subprocess

**Decision:** Use direct `soffice --headless --convert-to <format>` subprocess calls, not `unoconv`.

**Rationale:** `unoconv` is unmaintained (last release 2019). Direct `soffice` subprocess is the LibreOffice-recommended approach for headless conversion and works in every LibreOffice version since 5.x.

### D3 — Shared Docker volume + multipart upload, both supported

**Decision:** office-worker accepts files either as a path relative to `/data/files/` (shared volume) or as a `multipart/form-data` upload. Path mode is faster (no copy); upload mode works when the brain and office-worker don't share a volume.

**Rationale:** In local dev, a shared volume is natural and fast. In a future k8s setup, pods may not share a filesystem — uploads become the default. Supporting both avoids a forced migration.

### D4 — LaTeX: pdflatex for standard docs, lualatex for Unicode/CJK

**Decision:** The LaTeX endpoint accepts a `engine` parameter: `pdflatex` (default) or `lualatex`. TeX Live slim is installed; `texlive-latex-extra` and `texlive-lang-cjk` are added for broad package coverage.

**Rationale:** Most documents use pdflatex. CJK (Chinese/Japanese/Korean) content requires lualatex. Giving the caller the choice covers both without requiring two containers.

### D5 — Tracked changes returned as structured JSON, not raw XML

**Decision:** The `read_tracked_changes` endpoint returns a JSON array: `[{author, date, type (insert|delete|format), text}]`. The underlying OOXML revision markup is parsed by LibreOffice's Python UNO bridge for reading only (not writing tracked changes — that is intentionally excluded).

**Rationale:** Raw OOXML revision XML is unusable by an LLM. Structured JSON gives the agent actionable data. Writing new tracked changes requires a running Word/LibreOffice instance with user context — out of scope.

## Risks / Trade-offs

- **Cold start latency**: First `soffice` invocation after container start takes 3–5 seconds (JVM-style warm-up). Mitigation: run a no-op `soffice --headless --version` at container startup to pre-warm the binary.
- **LibreOffice fidelity**: Complex Word documents with custom fonts, embedded macros, or ActiveX controls may not roundtrip perfectly. Mitigation: document the limitation; office-worker is for programmatic document creation and standard business docs, not arbitrary document testing.
- **TeX Live image size**: `texlive-latex-recommended` adds ~300 MB. Mitigation: use `texlive-latex-recommended` + `texlive-fonts-recommended` rather than full TeX Live (~4 GB). Operators who need more packages can extend the Dockerfile.
- **Concurrent requests**: LibreOffice has per-user profile locks. Mitigation: configure a unique `--user-installation` tmp directory per request to allow parallelism.

## Migration Plan

1. Create `src/office-worker/` and `Dockerfile.office-worker`
2. Add `office-worker` to `docker-compose.local.yml` on port `9105`  
3. Update `native-skills` brain skill to call `OFFICE_WORKER_URL` instead of using Python libs
4. Remove `python-docx`, `openpyxl`, `python-pptx`, `pypdf` from brain `pyproject.toml`
5. No data migration needed — file storage in `/data/files/` is unchanged
