@echo off
rem KK MUD graphical client: starts the local proxy and opens the page. Needs Node.js.
rem Assets are read from ..\iKing_official\_extracted (override with the KK_ASSETS environment variable).
cd /d "%~dp0"
start "" http://localhost:8140/
node server.js 8140
