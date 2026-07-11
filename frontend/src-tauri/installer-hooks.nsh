; installer-hooks.nsh — Custom NSIS hooks for Fix_Spotify
; Tauri automatically loads this file from src-tauri/ during NSIS builds.

; ── PREINSTALL ──────────────────────────────────────────────────────────
; Runs BEFORE the installer copies files. Kills any running instances of
; the main app and the Python backend sidecar so the installer can safely
; overwrite them. Without this, reinstalling/updating while the app is
; running fails with "Error opening file for writing: backend.exe".
!macro NSIS_HOOK_PREINSTALL
  ; Kill the main Tauri app (may not be running — that's OK, taskkill
  ; returns non-zero but NSIS ignores the exit code via nsExec).
  nsExec::Exec 'taskkill /F /IM "Fix_Spotify.exe"'
  Pop $0

  ; Kill the Python backend sidecar. This is a SEPARATE process that
  ; survives even after the main window is closed, and it locks
  ; backend.exe on disk — the #1 cause of install failures.
  nsExec::Exec 'taskkill /F /IM "backend.exe"'
  Pop $0

  ; Give the OS time to release file handles after process termination.
  Sleep 2000
!macroend

; ── POSTINSTALL ─────────────────────────────────────────────────────────
; Runs AFTER the installer finishes copying files.
; (Nothing custom needed here — Tauri handles shortcuts and registry.)
; !macro NSIS_HOOK_POSTINSTALL
; !macroend

; ── PREUNINSTALL ────────────────────────────────────────────────────────
; Runs BEFORE the uninstaller deletes files. Same logic as preinstall:
; kill both processes so the uninstaller can cleanly remove everything.
!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM "Fix_Spotify.exe"'
  Pop $0

  nsExec::Exec 'taskkill /F /IM "backend.exe"'
  Pop $0

  Sleep 2000
!macroend

; ── POSTUNINSTALL ───────────────────────────────────────────────────────
; Runs AFTER the uninstaller removes files. Clean up any leftover data
; that the standard uninstaller doesn't know about (logs, cache, etc.).
!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove the app's log file from the temp directory
  Delete "$TEMP\fixspotify_boot.log"

  ; Remove the app data directory (~/.fix_spotify) which stores:
  ;   - config.json (YouTube browser preference)
  ;   - cookies.txt (imported YouTube cookies)
  ; Use /REBOOTOK in case any file is still locked (unlikely after kill).
  RMDir /r "$PROFILE\.fix_spotify"
!macroend
