@echo off
REM Rebuild the APK. Uses the portable JDK + Android SDK in Downloads\spotify\toolchain
REM (no Android Studio, no system install).
set TC=C:\Users\user\Downloads\spotify\toolchain
set JAVA_HOME=%TC%\jdk\jdk-17.0.19+10
set ANDROID_HOME=%TC%\android-sdk
set ANDROID_SDK_ROOT=%TC%\android-sdk

echo [1/2] Building the mobile web bundle...
cd /d "%~dp0..\..\frontend"
call npm run build:mobile || exit /b 1

echo [2/2] Building the APK...
cd /d "%~dp0android"
call gradlew.bat assembleRelease --console=plain || exit /b 1

echo.
echo APK: %~dp0android\app\build\outputs\apk\release\app-release.apk
