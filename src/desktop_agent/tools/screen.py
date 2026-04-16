"""Screenshot tool using mss."""
from __future__ import annotations

import base64
import io


async def screenshot(monitor: int | None = None) -> dict:
    try:
        import mss
        import mss.tools
        from PIL import Image

        with mss.mss() as sct:
            mon_idx = (monitor or 1)
            if mon_idx >= len(sct.monitors):
                mon_idx = 1
            mon = sct.monitors[mon_idx]
            raw = sct.grab(mon)
            img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")

            # Resize if wider than 1920px
            if img.width > 1920:
                ratio = 1920 / img.width
                img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            return {
                "image_base64": b64,
                "width": img.width,
                "height": img.height,
                "monitor": mon_idx,
            }
    except ImportError as exc:
        return {"error": f"mss or PIL not installed: {exc}"}
    except Exception as exc:
        return {"error": str(exc)}
