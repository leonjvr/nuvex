"""Desktop agent entry point — asyncio event loop."""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger(__name__)


async def _main() -> None:
    from desktop_agent.config import load_config, is_first_run
    from desktop_agent.connection import Connection

    cfg = load_config()
    if is_first_run(cfg):
        from desktop_agent.setup_wizard import run_wizard
        cfg = run_wizard()
        if cfg is None:
            log.info("Setup cancelled — exiting")
            return

    from desktop_agent.dispatcher import Dispatcher
    from desktop_agent.tools import TOOL_REGISTRY

    dispatcher = Dispatcher(TOOL_REGISTRY)
    conn = Connection(cfg, dispatcher)

    # Start tray in separate thread (pystray blocks its own thread)
    try:
        import threading
        from desktop_agent.tray import DesktopTray
        tray = DesktopTray(conn)
        conn.add_connect_callback(lambda: tray.set_state("connected_idle"))
        conn.add_disconnect_callback(lambda: tray.set_state("disconnected"))
        tray_thread = threading.Thread(target=tray.run, daemon=True)
        tray_thread.start()
    except Exception as exc:
        log.warning("Tray unavailable: %s", exc)

    await conn.connect_loop()


def main() -> None:
    import os
    from pathlib import Path

    appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
    log_dir = Path(appdata) / "Nuvex"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "desktop-agent.log"

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )
    log.info("NUVEX Desktop Agent 0.1.2 starting — log: %s", log_file)
    asyncio.run(_main())


if __name__ == "__main__":
    main()
