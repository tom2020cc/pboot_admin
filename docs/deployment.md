# Deployment Guide

## Required software

- Windows
- Node.js LTS
- phpStudy and the target PbootCMS website

## Steps

1. Copy this folder to the new computer.
2. Double-click `00-install.cmd`.
3. Double-click `01-config.cmd`.
4. Fill in the PbootCMS site root, database path, public domain, translation keys, and FTP settings.
5. Save the configuration.
6. Double-click `02-start.cmd`.
7. Open `http://localhost:5173`.

## First data import

For a new local database, import data in this order:

1. Open Menu Management and run `Sync menus from PbootCMS`.
2. Open News Management and run `Sync PbootCMS data`.
3. Open Product, Page and Video Management and import their data as needed.

Pulling data from PbootCMS is allowed when the local database is empty. Pushing
local data to PbootCMS is still blocked when the relevant local table is empty,
so an empty new installation cannot overwrite the website database.

## Important notes

- This package uses pnpm, matching the original project environment.
- Do not install the main project dependencies with npm.
- Do not copy `node_modules`.
- Do not reuse `.env` from another website. Use `01-config.cmd` to generate a fresh one.
- If ports are occupied, run `04-stop-ports.cmd`.

## Default ports

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:5173`
- Config wizard: `http://localhost:5190`
- SEO tool: `http://localhost:5188`
- FTP tool: `http://localhost:5189`
