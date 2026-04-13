## Why

Business agents that create, review, and modify documents need full-fidelity office document support: tracked changes, reviewer comments, named styles, cross-references, pivot tables, and publication-quality PDF output. Python in-process libraries (`python-docx`, `openpyxl`) handle basic content well but cannot roundtrip tracked changes, comments, or complex formatting without corruption. LibreOffice is the only open-source engine that handles all of these with complete fidelity.

Rather than embedding LibreOffice into the brain container (adding ~300 MB to every brain deployment), a dedicated `office-worker` container isolates the capability: it scales independently, upgrades independently, and in a future Kubernetes environment each organisation can have its own worker pod. The brain's `office-docs-skill` becomes a thin HTTP client — it knows nothing about document internals.

Adding a LaTeX rendering pipeline to the same container is a natural fit: LaTeX is the standard for scientific, financial, and legal documents where precise typesetting matters. Both LibreOffice and LaTeX produce PDFs; the same container serves both.

## What Changes

- New `office-worker` Docker service — FastAPI app with LibreOffice headless + TeX Live slim
- Exposes a REST API for: document read (text, tables, comments, tracked changes), document write/create, format conversion (docx→pdf, tex→pdf, xlsx→csv, pptx→pdf), and tracked-change operations (accept-all, reject-all, list changes)
- Port `9105` in local dev; Netbird IP in production
- Brain's `office-docs-skill` calls `office-worker` via `OFFICE_WORKER_URL` env var; brain image loses the Python doc libs
- Files are passed as multipart/form-data uploads; results returned as download streams or JSON
- New `Dockerfile.office-worker`; new service in `docker-compose.local.yml`

## Capabilities

### New Capabilities

- `office-worker-api`: The HTTP service contract — endpoints, auth, error codes, file size limits
- `libreoffice-processing`: Document read, write, convert, and tracked-change operations via LibreOffice headless
- `latex-processing`: LaTeX source → PDF compilation via TeX Live; error log returned on failure

### Modified Capabilities

- (none — office-worker is a new standalone service; brain's office-docs-skill behaviour is updated in the `native-skills` change)

## Impact

- **New service**: `src/office-worker/` Python FastAPI app
- **New Dockerfile**: `Dockerfile.office-worker` — python:3.12-slim base + `apt-get install libreoffice texlive-latex-recommended texlive-fonts-recommended`
- **New port**: `9105` (local dev)
- **`docker-compose.local.yml`**: add `office-worker` service
- **Brain image**: remove `python-docx`, `openpyxl`, `python-pptx`, `pypdf` deps; add `httpx` for client calls
- **New env var on brain**: `OFFICE_WORKER_URL` (default `http://office-worker:9105`)
- **File size limit**: 50 MB per operation (LibreOffice can handle larger files than the Python libs)
