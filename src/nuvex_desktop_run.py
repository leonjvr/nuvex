"""PyInstaller entry point for nuvex-desktop.exe.

This file lives at src/ level so that `desktop_agent` is a proper package.
"""
from desktop_agent.__main__ import main

if __name__ == "__main__":
    main()
