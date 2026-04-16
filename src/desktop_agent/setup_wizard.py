"""First-run setup wizard (tkinter)."""
from __future__ import annotations

import logging
import sys

log = logging.getLogger(__name__)


def run_wizard():
    """Show first-run wizard. Returns DesktopAgentConfig or None if cancelled."""
    if sys.platform != "win32":
        log.info("setup_wizard: non-Windows platform, returning default config")
        from .config import DesktopAgentConfig
        return DesktopAgentConfig()

    try:
        import tkinter as tk
        from tkinter import ttk
        from .config import DesktopAgentConfig, save_config

        result: list = []

        root = tk.Tk()
        root.title("NUVEX Desktop Agent — Setup")
        root.geometry("500x400")
        root.resizable(False, False)

        tk.Label(root, text="NUVEX Desktop Agent Setup", font=("Arial", 14, "bold")).pack(pady=15)

        frame = tk.Frame(root)
        frame.pack(padx=30, fill="x")

        tk.Label(frame, text="Brain URL:").grid(row=0, column=0, sticky="w", pady=5)
        brain_url_var = tk.StringVar(value="http://localhost:9100")
        tk.Entry(frame, textvariable=brain_url_var, width=40).grid(row=0, column=1, pady=5)

        tk.Label(frame, text="Device Token:").grid(row=1, column=0, sticky="w", pady=5)
        token_var = tk.StringVar()
        tk.Entry(frame, textvariable=token_var, width=40, show="*").grid(row=1, column=1, pady=5)

        tk.Label(frame, text="Mode:").grid(row=2, column=0, sticky="w", pady=5)
        mode_var = tk.StringVar(value="ask")
        mode_frame = tk.Frame(frame)
        mode_frame.grid(row=2, column=1, sticky="w")
        tk.Radiobutton(mode_frame, text="Ask for permission", variable=mode_var, value="ask").pack(side="left")
        tk.Radiobutton(mode_frame, text="Auto", variable=mode_var, value="auto").pack(side="left")

        tk.Label(frame, text="Idle threshold (s):").grid(row=3, column=0, sticky="w", pady=5)
        idle_var = tk.IntVar(value=60)
        tk.Scale(frame, variable=idle_var, from_=15, to=300, orient="horizontal", length=200).grid(row=3, column=1)

        status_label = tk.Label(root, text="", fg="gray")
        status_label.pack(pady=5)

        def _test_connection():
            import urllib.request
            url = brain_url_var.get().rstrip("/") + "/health"
            try:
                urllib.request.urlopen(url, timeout=3)
                status_label.config(text="Connection OK", fg="green")
            except Exception as exc:
                status_label.config(text=f"Failed: {exc}", fg="red")

        def _save():
            cfg = DesktopAgentConfig(
                brain_url=brain_url_var.get().strip(),
                auth_token=token_var.get().strip(),
                desktop_mode=mode_var.get(),
                idle_threshold_seconds=idle_var.get(),
            )
            save_config(cfg)
            result.append(cfg)
            root.destroy()

        def _cancel():
            root.destroy()

        btn_frame = tk.Frame(root)
        btn_frame.pack(pady=10)
        tk.Button(btn_frame, text="Test Connection", command=_test_connection).pack(side="left", padx=5)
        tk.Button(btn_frame, text="Save & Start", command=_save, bg="#4CAF50", fg="white").pack(side="left", padx=5)
        tk.Button(btn_frame, text="Cancel", command=_cancel).pack(side="left", padx=5)

        root.mainloop()
        return result[0] if result else None

    except Exception as exc:
        log.warning("setup_wizard: failed: %s", exc)
        return None


def open_settings(cfg=None, conn=None) -> None:
    """Open the settings window pre-filled with current config. Blocks until closed."""
    if sys.platform != "win32":
        return

    try:
        import tkinter as tk
        from desktop_agent.config import DesktopAgentConfig, load_config, save_config

        if cfg is None:
            cfg = load_config()

        root = tk.Tk()
        root.title("NUVEX Desktop Agent — Settings")
        root.geometry("500x450")
        root.resizable(False, False)
        root.lift()
        root.focus_force()

        tk.Label(root, text="NUVEX Desktop Agent Settings", font=("Arial", 14, "bold")).pack(pady=15)

        # Live connection status banner
        conn_status_var = tk.StringVar()
        conn_status_label = tk.Label(root, textvariable=conn_status_var, font=("Arial", 10))
        conn_status_label.pack(pady=(0, 8))

        def _update_conn_status():
            if conn is not None and conn.is_connected:
                conn_status_var.set("● Connected to NUVEX")
                conn_status_label.config(fg="#4CAF50")
            else:
                conn_status_var.set("● Disconnected")
                conn_status_label.config(fg="#9E9E9E")
            root.after(1000, _update_conn_status)

        _update_conn_status()

        frame = tk.Frame(root)
        frame.pack(padx=30, fill="x")

        tk.Label(frame, text="Brain URL:").grid(row=0, column=0, sticky="w", pady=5)
        brain_url_var = tk.StringVar(value=cfg.brain_url)
        tk.Entry(frame, textvariable=brain_url_var, width=40).grid(row=0, column=1, pady=5)

        tk.Label(frame, text="Device Token:").grid(row=1, column=0, sticky="w", pady=5)
        token_var = tk.StringVar(value=cfg.auth_token)
        tk.Entry(frame, textvariable=token_var, width=40, show="*").grid(row=1, column=1, pady=5)

        tk.Label(frame, text="Mode:").grid(row=2, column=0, sticky="w", pady=5)
        mode_var = tk.StringVar(value=cfg.desktop_mode)
        mode_frame = tk.Frame(frame)
        mode_frame.grid(row=2, column=1, sticky="w")
        tk.Radiobutton(mode_frame, text="Ask for permission", variable=mode_var, value="ask").pack(side="left")
        tk.Radiobutton(mode_frame, text="Auto", variable=mode_var, value="auto").pack(side="left")

        tk.Label(frame, text="Idle threshold (s):").grid(row=3, column=0, sticky="w", pady=5)
        idle_var = tk.IntVar(value=cfg.idle_threshold_seconds)
        tk.Scale(frame, variable=idle_var, from_=15, to=300, orient="horizontal", length=200).grid(row=3, column=1)

        status_label = tk.Label(root, text="", fg="gray")
        status_label.pack(pady=5)

        def _test_connection():
            import urllib.request
            url = brain_url_var.get().rstrip("/") + "/health"
            try:
                urllib.request.urlopen(url, timeout=3)
                status_label.config(text="Connection OK", fg="green")
            except Exception as exc:
                status_label.config(text=f"Failed: {exc}", fg="red")

        def _save():
            new_cfg = DesktopAgentConfig(
                brain_url=brain_url_var.get().strip(),
                device_id=cfg.device_id,
                auth_token=token_var.get().strip(),
                desktop_mode=mode_var.get(),
                idle_threshold_seconds=idle_var.get(),
            )
            save_config(new_cfg)
            status_label.config(text="Saved. Reconnecting...", fg="green")
            root.after(800, root.destroy)

        def _cancel():
            root.destroy()

        btn_frame = tk.Frame(root)
        btn_frame.pack(pady=10)
        tk.Button(btn_frame, text="Test Connection", command=_test_connection).pack(side="left", padx=5)
        tk.Button(btn_frame, text="Save", command=_save, bg="#4CAF50", fg="white").pack(side="left", padx=5)
        tk.Button(btn_frame, text="Cancel", command=_cancel).pack(side="left", padx=5)

        root.mainloop()

    except Exception as exc:
        log.warning("setup_wizard: open_settings failed: %s", exc)
