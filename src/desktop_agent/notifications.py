"""Notifications — Windows toast via winotify and tkinter popups."""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
from typing import Any

log = logging.getLogger(__name__)


class NotificationManager:
    def notify_pending(self, count: int) -> None:
        self._toast(
            "NUVEX Desktop Agent",
            f"You have {count} task(s) ready — waiting for your desktop to be free",
        )

    def notify_executing(self, task_name: str) -> None:
        self._toast("NUVEX Desktop Agent", f"Executing: {task_name}")

    def notify_complete(self, summary: str) -> None:
        self._toast("NUVEX Desktop Agent", f"Done: {summary}")

    def notify_error(self, message: str) -> None:
        self._toast("NUVEX Desktop Agent", f"Error: {message}")

    def _toast(self, title: str, message: str) -> None:
        if sys.platform != "win32":
            log.info("[toast] %s: %s", title, message)
            return
        try:
            from winotify import Notification
            n = Notification(app_id="NUVEX", title=title, msg=message)
            n.show()
        except Exception as exc:
            log.debug("toast failed: %s", exc)

    async def show_approval_popup(self, tasks: list) -> bool:
        """Show approval dialog. Returns True if user approves."""
        if sys.platform != "win32":
            return True  # auto-approve in non-GUI environments
        result: list[bool] = []
        event = threading.Event()

        def _show() -> None:
            try:
                import tkinter as tk
                from tkinter import ttk
                root = tk.Tk()
                root.title("NUVEX — Approve Tasks")
                root.geometry("400x300")
                root.attributes("-topmost", True)
                tk.Label(root, text=f"NUVEX wants to run {len(tasks)} task(s):", font=("Arial", 11)).pack(pady=10)
                for t in tasks[:5]:
                    tk.Label(root, text=f"• {getattr(t, 'tool', str(t))}").pack(anchor="w", padx=20)
                if len(tasks) > 5:
                    tk.Label(root, text=f"... and {len(tasks) - 5} more").pack(anchor="w", padx=20)
                frame = tk.Frame(root)
                frame.pack(pady=20)
                def _approve():
                    result.append(True)
                    root.destroy()
                def _reject():
                    result.append(False)
                    root.destroy()
                tk.Button(frame, text="Approve All", command=_approve, bg="#4CAF50", fg="white").pack(side="left", padx=5)
                tk.Button(frame, text="Reject All", command=_reject, bg="#f44336", fg="white").pack(side="left", padx=5)
                root.after(300_000, _reject)  # auto-reject after 5 min
                root.mainloop()
            except Exception as exc:
                log.warning("approval popup failed: %s", exc)
                result.append(False)
            finally:
                event.set()

        t = threading.Thread(target=_show, daemon=True)
        t.start()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, event.wait)
        return bool(result) and result[0]
