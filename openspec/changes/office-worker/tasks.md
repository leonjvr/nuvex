## 1. Project Setup

- [ ] 1.1 Create `src/office-worker/` directory and `src/office-worker/main.py` FastAPI entry point
- [ ] 1.2 Create `src/office-worker/pyproject.toml` with deps: `fastapi`, `uvicorn`, `python-multipart`, `httpx`
- [ ] 1.3 Create `Dockerfile.office-worker`: `python:3.12-slim` base; install `libreoffice`, `texlive-latex-recommended`, `texlive-fonts-recommended`, `texlive-latex-extra`, `texlive-lang-cjk`; copy app; set entrypoint
- [ ] 1.4 Add `office-worker` service to `docker-compose.local.yml` on port `9105` with `/data/files/` volume mount
- [ ] 1.5 Add `OFFICE_WORKER_URL` env var (`http://office-worker:9105`) to `config/channels.env.example`
- [ ] 1.6 Pre-warm LibreOffice on FastAPI startup event: run `soffice --headless --version` subprocess

## 2. Core API Scaffolding

- [ ] 2.1 Implement `GET /health` endpoint returning `{"status": "ok", "libreoffice_version": "..."}"`
- [ ] 2.2 Implement 50 MB file size middleware: inspect `Content-Length` and reject with HTTP 413 before processing
- [ ] 2.3 Implement shared helper `run_soffice(args, user_install_dir)`: runs `soffice --headless --norestore --user-installation=<dir> <args>`, captures stdout/stderr, raises on non-zero exit
- [ ] 2.4 Implement `make_temp_dir()` context manager: creates unique temp dir, yields path, deletes on exit

## 3. Document Read Endpoint

- [ ] 3.1 Implement `POST /v1/read`: accept multipart file upload or `{"path": "..."}` JSON body
- [ ] 3.2 Extract full text via LibreOffice `--convert-to txt` subprocess; parse output into paragraphs
- [ ] 3.3 Parse OOXML XML directly (via `zipfile` + `xml.etree`) for tables, comments (`w:comment`), and tracked changes (`w:ins`, `w:del`) — return as structured JSON
- [ ] 3.4 Return `{"text": "...", "tables": [[...]], "comments": [{author, date, text}], "tracked_changes": [{author, date, type, text}]}`

## 4. Document Write Endpoint

- [ ] 4.1 Implement `POST /v1/write`: accept JSON body with `type`, `paragraphs` (each with `text` and optional `style`), optional `tables`
- [ ] 4.2 Generate a minimal OOXML `.docx` from scratch using `zipfile` + XML templates for paragraphs and tables with named styles; return as octet-stream
- [ ] 4.3 For `.xlsx` write: generate using `openpyxl` (kept in office-worker image only, not in brain); return as octet-stream
- [ ] 4.4 For `.pptx` write: generate using `python-pptx` (kept in office-worker image only); return as octet-stream

## 5. Tracked Changes Operations

- [ ] 5.1 Implement `POST /v1/accept-changes`: use LibreOffice macro via `--headless` to accept all tracked changes; return cleaned document
- [ ] 5.2 Implement `POST /v1/reject-changes`: same pattern, reject all tracked changes
- [ ] 5.3 Use unique `--user-installation` temp dir per invocation to allow concurrency

## 6. Format Conversion Endpoint

- [ ] 6.1 Implement `POST /v1/convert`: accept source file + `target_format` parameter
- [ ] 6.2 Supported conversions: `docx→pdf`, `xlsx→pdf`, `pptx→pdf`, `xlsx→csv`, `docx→txt`, `odt→docx`
- [ ] 6.3 Reject unsupported `target_format` with HTTP 400 and list of supported formats
- [ ] 6.4 Run `soffice --headless --convert-to <format> --outdir <tmpdir> <file>` and return output file as octet-stream

## 7. LaTeX Endpoints

- [ ] 7.1 Implement `POST /v1/latex/compile`: accept single `.tex` file or `.zip` archive; `engine` param (`pdflatex`|`lualatex`, default `pdflatex`)
- [ ] 7.2 For ZIP upload: extract to temp dir, verify `main.tex` exists, compile from that directory
- [ ] 7.3 Run `pdflatex` or `lualatex` with `-interaction=nonstopmode -output-directory=<tmpdir> main.tex`; run twice for cross-references
- [ ] 7.4 On success: return `main.pdf` as octet-stream
- [ ] 7.5 On failure (non-zero exit): return HTTP 422 with `{"error_log": "<stdout/stderr>"}"`
- [ ] 7.6 Clean up temp dir after response regardless of success/failure

## 8. Tests

- [ ] 8.1 Unit tests for `run_soffice` helper: mock subprocess, assert args constructed correctly
- [ ] 8.2 Unit tests for OOXML parser (read endpoint): fixture `.docx` files with comments, tracked changes, tables; assert correct JSON output  
- [ ] 8.3 Integration tests for `/v1/convert`: docx→pdf, xlsx→csv (requires LibreOffice; skip if not in CI)
- [ ] 8.4 Integration tests for `/v1/latex/compile`: valid .tex → PDF; invalid .tex → 422 with log
- [ ] 8.5 Test concurrent requests do not block each other (two simultaneous conversions complete successfully)
- [ ] 8.6 Test 50 MB file rejection returns HTTP 413
