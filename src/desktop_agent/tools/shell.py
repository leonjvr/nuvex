"""Shell and application launch tools (T1 only)."""
from __future__ import annotations

import subprocess


async def run_app(executable: str, args: list[str] | None = None) -> dict:
    try:
        cmd = [executable] + (args or [])
        proc = subprocess.Popen(cmd)
        return {"pid": proc.pid, "started": True}
    except FileNotFoundError:
        return {"pid": -1, "started": False, "error": f"Executable not found: {executable}"}
    except Exception as exc:
        return {"pid": -1, "started": False, "error": str(exc)}


async def shell_exec(command: str, timeout: int = 30) -> dict:
    _MAX_OUTPUT = 10 * 1024  # 10 KB
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "stdout": result.stdout[:_MAX_OUTPUT],
            "stderr": result.stderr[:_MAX_OUTPUT],
            "exit_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "timed out", "exit_code": -1}
    except Exception as exc:
        return {"stdout": "", "stderr": str(exc), "exit_code": -1}
