@echo off
setlocal
cd /d "%~dp0"
title Technocore Agent Dashboard - Setup

echo.
echo =====================================================
echo   Technocore Agent Dashboard - First-Time Setup
echo =====================================================
echo.
echo This window will install one trusted Python package:
echo cryptography. It is used to sign your messages locally.
echo.

set "PYTHON_CMD=python"
py -3.12 --version >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3.12"

%PYTHON_CMD% --version >nul 2>&1
if errorlevel 1 (
  echo Python was not found.
  echo Install Python 3.12 from https://www.python.org/downloads/windows/
  echo During installation, check "Add Python to PATH".
  echo.
  pause
  exit /b 1
)

echo Installing the signing package...
%PYTHON_CMD% -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo.
  echo Setup could not install the signing package.
  echo Check your internet connection, then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo Setup is complete. Opening the dashboard...
echo.
%PYTHON_CMD% "%~dp0technocore_dashboard.py"

if errorlevel 1 (
  echo.
  echo The dashboard closed after an error. Take a screenshot of this window.
  echo Do NOT include your private-key JSON in the screenshot.
  echo.
  pause
)

endlocal
