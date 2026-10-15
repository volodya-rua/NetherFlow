@echo off
rem NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
rem Builds the Android app into dist\NetherFlow.apk, signed with the key in %USERPROFILE%\.netherflow-signing (see README).
rem Needs Java 21 (looked up in %USERPROFILE%\.jdks) and the Android SDK.
setlocal
set "ROOT=%~dp0"
set "JAVA_HOME="
for /d %%J in ("%USERPROFILE%\.jdks\jdk-21*") do set "JAVA_HOME=%%~fJ"
if not defined JAVA_HOME (echo Java 21 not found in %USERPROFILE%\.jdks & exit /b 1)
cd /d "%ROOT%"
call npm run android:sync || exit /b 1
cd /d "%ROOT%android"
rem -D overrides any Gradle-wide Java setting, which may point at an older Java
call "%ROOT%android\gradlew.bat" -Dorg.gradle.java.home="%JAVA_HOME%" assembleRelease assembleDebug || exit /b 1
if not exist "%ROOT%dist" mkdir "%ROOT%dist"
copy /y "%ROOT%android\app\build\outputs\apk\release\app-release.apk" "%ROOT%dist\NetherFlow.apk" >nul && echo Built dist\NetherFlow.apk
