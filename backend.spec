# backend.spec - PyInstaller spec for the Python backend
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# yt-dlp-ejs ships JS files used to solve YouTube's n-signature challenge; they
# are loaded dynamically, so PyInstaller can't see them without an explicit
# collect. certifi's CA bundle is data too. (ffmpeg/ffprobe/deno are NOT bundled
# here — they ride along as Tauri resources next to the app; see tauri.conf.json.)
_datas = [('components', 'components')]
_datas += collect_data_files('yt_dlp_ejs')
_datas += collect_data_files('certifi')

_hidden = [
    'mutagen', 'mutagen.mp3', 'mutagen.id3', 'mutagen.flac', 'mutagen.mp4',
    'yt_dlp', 'nodriver', 'browser_cookie3', 'certifi',
    'fastapi', 'uvicorn', 'pydantic',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan.on',
    'uvicorn.logging',
    'uvicorn.loops.auto',
    'uvicorn.supervisors.multiprocess',
    'uvicorn.workers.fork',
]
_hidden += collect_submodules('yt_dlp_ejs')

a = Analysis(
    ['api/main.py'],
    pathex=[],
    binaries=[],
    datas=_datas,
    hiddenimports=_hidden,
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
    name='backend',
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
)