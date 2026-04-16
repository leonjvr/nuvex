# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for NUVEX Desktop Agent

block_cipher = None

import os as _os
_src_dir = _os.path.abspath(_os.path.join(SPECPATH, '..'))

a = Analysis(
    [_os.path.join(_src_dir, 'nuvex_desktop_run.py')],
    pathex=[_src_dir],
    binaries=[],
    datas=[(_os.path.join(SPECPATH, 'assets'), 'assets')],
    hiddenimports=[
        'win32com.client',
        'win32com.server.util',
        'pywintypes',
        'pythoncom',
        'win32api',
        'win32con',
        'pynput.keyboard._win32',
        'pynput.mouse._win32',
        'pystray',
        'pystray._win32',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageFont',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='nuvex-desktop-0.1.2-windows',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/nuvex-tray-green.ico',
)
