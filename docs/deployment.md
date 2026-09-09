# Central Multi-Site Deployment Guide

## Local Windows setup

1. Install Node.js LTS, pnpm and phpStudy.
2. Put this project in `E:\phpstudy_pro\WWW\pboot_admin_center`.
3. Run `00-install.cmd` once.
4. Run `07-start-all.cmd` and keep the visible backend API terminal open.
5. Run `03-create-admin.cmd` when the installation has no administrator.
6. Open `http://localhost:5278/#/sites`.
7. Scan the phpStudy `WWW` parent directory, select the PbootCMS sites and import them.

Do not create one copy of this management project per website. All websites share ports `5108`, `5278`, `5388` and `5389`; the selected `siteId` determines which website is read or changed.

## Per-site and shared data

Shared by every website:

- Backend/frontend/SEO/FTP source code and processes.
- Administrator accounts.
- AI model API keys.
- YouTube Data API key.

Independent for every website:

- PbootCMS root path, SQLite database and public URL.
- YouTube channel ID.
- SEO, Search Console, Indexing API, IndexNow and Baidu settings.
- FTP credentials, trusted baseline, scan history and resume checkpoint.
- Menu, news, product, page, video and quotation records, isolated by `siteId`.

Runtime files are stored in `managed-sites/<site-code>/` and are excluded from Git because they may contain secrets.

## First import for a site

1. Select the site in the top site switcher.
2. Import menus from that site's PbootCMS database.
3. Import news, products, pages and videos as needed.
4. Check the selected site name before every full import, push or FTP operation.

Full imports delete and rebuild only the selected site's central records. They no longer clear another site's data.

## Production deployment

For Linux and BT Panel, follow [BAOTA_MULTI_SITE_DEPLOY_ZH.md](BAOTA_MULTI_SITE_DEPLOY_ZH.md). Use one PM2 service set and one `managed-sites` directory. Do not assign a separate backend port to every PbootCMS website.

## Default ports

- Backend API: `http://localhost:5108`
- Management frontend: `http://localhost:5278`
- SEO tool: `http://localhost:5388`
- FTP tool: `http://localhost:5389`
