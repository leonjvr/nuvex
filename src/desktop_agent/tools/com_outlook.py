"""Outlook COM automation tools (win32com)."""
from __future__ import annotations

import sys
from typing import Any


def _get_outlook():
    """Get or start Outlook Application COM object."""
    import win32com.client
    try:
        return win32com.client.GetActiveObject("Outlook.Application")
    except Exception:
        return win32com.client.Dispatch("Outlook.Application")


async def get_emails(folder: str = "Inbox", count: int = 10, search: str | None = None) -> dict:
    if sys.platform != "win32":
        return {"emails": [], "error": "Windows only"}
    try:
        outlook = _get_outlook()
        ns = outlook.GetNamespace("MAPI")
        inbox = ns.GetDefaultFolder(6)  # 6 = Inbox

        if folder != "Inbox":
            for i in range(inbox.Parent.Folders.Count):
                f = inbox.Parent.Folders[i + 1]
                if f.Name.lower() == folder.lower():
                    inbox = f
                    break

        items = inbox.Items
        items.Sort("[ReceivedTime]", True)

        emails = []
        for i, mail in enumerate(items):
            if i >= count:
                break
            try:
                if search and search.lower() not in (mail.Subject or "").lower():
                    continue
                emails.append({
                    "subject": mail.Subject or "",
                    "from": mail.SenderEmailAddress or "",
                    "date": str(mail.ReceivedTime),
                    "body_preview": (mail.Body or "")[:200],
                    "entry_id": mail.EntryID,
                })
            except Exception:
                continue
        return {"emails": emails}
    except ImportError:
        return {"emails": [], "error": "pywin32 not installed"}
    except Exception as exc:
        return {"emails": [], "error": _com_error(exc)}


async def send_email(
    to: str | list[str],
    subject: str,
    body: str,
    cc: str | list[str] | None = None,
    attachments: list[str] | None = None,
) -> dict:
    if sys.platform != "win32":
        return {"sent": False, "error": "Windows only"}
    try:
        outlook = _get_outlook()
        mail = outlook.CreateItem(0)  # 0 = MailItem
        recipients = [to] if isinstance(to, str) else to
        mail.To = "; ".join(recipients)
        mail.Subject = subject
        mail.Body = body
        if cc:
            mail.CC = "; ".join([cc] if isinstance(cc, str) else cc)
        if attachments:
            for path in attachments:
                mail.Attachments.Add(path)
        mail.Send()
        return {"sent": True, "to": recipients}
    except ImportError:
        return {"sent": False, "error": "pywin32 not installed"}
    except Exception as exc:
        return {"sent": False, "error": _com_error(exc)}


async def reply_email(entry_id: str, body: str, reply_all: bool = False) -> dict:
    if sys.platform != "win32":
        return {"replied": False, "error": "Windows only"}
    try:
        outlook = _get_outlook()
        ns = outlook.GetNamespace("MAPI")
        mail = ns.GetItemFromID(entry_id)
        reply = mail.ReplyAll() if reply_all else mail.Reply()
        reply.Body = body + "\n\n" + reply.Body
        reply.Send()
        return {"replied": True, "subject": mail.Subject}
    except ImportError:
        return {"replied": False, "error": "pywin32 not installed"}
    except Exception as exc:
        return {"replied": False, "error": _com_error(exc)}


async def move_email(entry_id: str, target_folder: str) -> dict:
    if sys.platform != "win32":
        return {"moved": False, "error": "Windows only"}
    try:
        outlook = _get_outlook()
        ns = outlook.GetNamespace("MAPI")
        mail = ns.GetItemFromID(entry_id)
        inbox = ns.GetDefaultFolder(6)
        target = None
        for i in range(inbox.Parent.Folders.Count):
            f = inbox.Parent.Folders[i + 1]
            if f.Name.lower() == target_folder.lower():
                target = f
                break
        if target is None:
            return {"moved": False, "error": f"Folder '{target_folder}' not found"}
        mail.Move(target)
        return {"moved": True}
    except ImportError:
        return {"moved": False, "error": "pywin32 not installed"}
    except Exception as exc:
        return {"moved": False, "error": _com_error(exc)}


def _com_error(exc: Exception) -> str:
    try:
        import pywintypes
        if isinstance(exc, pywintypes.com_error):
            hr = exc.args[0] if exc.args else "unknown"
            msg = str(exc.args[2][2]) if len(exc.args) > 2 and exc.args[2] else str(exc)
            return f"COM error HRESULT={hr}: {msg}"
    except ImportError:
        pass
    return str(exc)
