@echo off
REM Sylou Local on Windows: start the PowerShell script with the execution
REM policy bypassed for this one process.
REM
REM Windows refuses to run unsigned scripts that were downloaded, and a
REM release is a downloaded file. The bypass applies to this process alone:
REM nothing about your computer's settings is changed (D21).
powershell.exe -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0sylou.ps1" %*
exit /b %ERRORLEVEL%
