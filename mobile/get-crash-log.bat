@echo off
REM ---------------------------------------------------------------------------
REM Capture the exact reason Fix_Spotify is crashing on the phone.
REM
REM Setup on the phone (one time):
REM   Settings > About phone > tap "Build number" 7 times   (enables Developer options)
REM   Settings > System > Developer options > enable "USB debugging"
REM   Plug the phone in via USB, then tap "Allow" on the debugging prompt.
REM
REM Then just run this file and open the app on your phone when it says to.
REM ---------------------------------------------------------------------------

set ADB=C:\Users\user\Downloads\spotify\toolchain\android-sdk\platform-tools\adb.exe
set OUT=%~dp0crash-log.txt

echo === Checking for your phone ===
"%ADB%" devices
echo.
echo If no device is listed above with "device" next to it, USB debugging is not on.
echo (If it says "unauthorized", unlock the phone and tap Allow.)
echo.
pause

echo === Clearing old logs ===
"%ADB%" logcat -c

echo.
echo ============================================================
echo   NOW OPEN Fix_Spotify ON YOUR PHONE AND LET IT CRASH.
echo   Then come back here and press any key.
echo ============================================================
pause

echo === Saving log to %OUT% ===
REM Grab everything relevant: our own tags, the Python backend, Chaquopy,
REM and any hard crash (AndroidRuntime / FATAL).
"%ADB%" logcat -d > "%OUT%"

echo.
echo ---------- MOST LIKELY CAUSE ----------
"%ADB%" logcat -d | findstr /C:"FATAL EXCEPTION" /C:"AndroidRuntime" /C:"FixSpotifyPy" /C:"FixSpotifySvc" /C:"chaquopy" /C:"python"
echo ---------------------------------------
echo.
echo Full log saved to: %OUT%
echo Send me that file (or the lines above) and I will pinpoint it.
pause
