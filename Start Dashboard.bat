@echo off
setlocal
cd /d "%~dp0"
title Technocore Agent Dashboard

set "PYTHON_CMD=python"
py -3.12 --version >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3.12"

%PYTHON_CMD% "%~dp0technocore_dashboard.py"
if errorlevel 1 (
  echo.
  echo The dashboard needs setup or encountered an error.
  echo First try double-clicking "Install and Start.bat".
  echo.
  pause
)

endlocal
