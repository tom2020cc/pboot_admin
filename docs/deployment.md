# Central Multi-Site Deployment Guide

## Current project update policy (2026-09-13)

- Focus on implementing and verifying features. Do not automatically back up source code, commit, or upload to GitHub. Do those only when the owner explicitly requests them.
- `install-brochure-update.cjs` and `install-tutorial-update.sh` now default to no code backup. `--backup` is opt-in and requires the owner's explicit request; do not pass it automatically.
- Source fingerprints are overwrite preconditions, not source copies. Update archives and next-build directories are deployment inputs, not backups of the previous project. Without a requested backup these installers cannot automatically roll back previous source.
- Do not remove existing backups or change existing product/news data as part of this policy. Database write safeguards for actual business operations are separate from source-code backups.

## Local Windows setup

1. Install Node.js LTS, pnpm and phpStudy.
2. Put this project in `E:\phpstudy_pro\WWW\pboot_admin_center`.
3. Run `install.cmd` once.
4. Run `start.cmd` and keep the visible backend API terminal open.
5. Run `create-admin.cmd` when the installation has no administrator.
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
3. Import news, products and pages as needed. The current video module uses a per-site YouTube channel and the shared YouTube API key; configure those separately instead of treating its sync button as a generic PB import.
4. Check the selected site name before every full import, push or FTP operation.

Full imports delete and rebuild only the selected site's central records. They no longer clear another site's data.

### BaoTa site onboarding

The scanner and new-site form read authenticated `GET /sites/runtime-defaults`. A fresh Linux installation defaults to BaoTa and `/www/wwwroot`; Windows defaults to phpStudy. An absolute `PBOOT_SITE_ROOT` supplies its parent directory when compatible with the server OS. When a site is already selected, its environment and parent directory take precedence. These paths belong to the server, not the browser computer.

For an existing live site, check its actual `config/database.php` and select that SQLite database. Save its HTTPS public URL, run the site check, then pull PB menus before importing content. Confirm that the operation reads **from PB into the management center**, not the reverse push. Do not repeatedly rebuild a site containing unsaved central edits.

Images under the website's existing `static` directory remain in place. The central UI serves their previews through `/api/sites/static-file?siteId=...&path=...`. A missing source file must be restored or reuploaded; changing the web server or repeating content import does not recreate it. Check product large images and custom field visibility after import. Read PB fields first; enabling an existing field in the central editor does not require writing its definition back to PB.

Preview template bindings before applying them. Matching CN/EN column codes need no template rewrite. Keep unresolved legacy codes unchanged until their intended columns are known.

### PbootCMS on Nginx

Nginx does not enforce Apache `.htaccess`. Check the business site's document root, PHP handler and URL rules in BaoTa rather than copying the management app's reverse-proxy configuration over it. Preserve existing SSL and other site settings.

The repository provides `deploy/nginx/pboot-production-guard.conf` for a PbootCMS **business site's** server block. It blocks public `/data/` access and root-level database/archive downloads. Review the rule if the site intentionally provides downloads at its document root. Do not install it globally or in the admin/SEO/FTP proxy projects.

On the verified BaoTa installation, the existing business vhost includes its `extension/<domain>/*.conf` directory. Back up that vhost outside the web root, place the guard in this already-included directory, run `nginx -t`, and reload only after validation succeeds. Other installations must first confirm the include is present. Verify that the home page remains 200 while database and deployment archive URLs return 404. This guard does not replace full web-server hardening or restore missing media.

## Production deployment

For Linux and BT Panel, follow [BAOTA_MULTI_SITE_DEPLOY_ZH.md](BAOTA_MULTI_SITE_DEPLOY_ZH.md). Use one PM2 service set and one `managed-sites` directory. Do not assign a separate backend port to every PbootCMS website.

The [2026-09-11 deployment record and screenshot index](tutorial-assets/baota-2026-09-11/README.md) documents all three BaoTa HTTPS projects, successful production endpoint checks, and the remaining business configuration. Raw screenshots stay local and are not published to Git by default. This deployment's changes have not been committed or uploaded to GitHub, at the owner's request.

For independent HTTPS tool subdomains, run `node deploy/configure-public-urls.cjs https://admin.example.com https://seo-admin.example.com https://ftp-admin.example.com` after initializing the environment files. Then rebuild the frontend and restart both tools. This sets `ADMIN_PUBLIC_URL`, `SEO_PUBLIC_URL`, `FTP_PUBLIC_URL` in the backend environment and the frontend's `VITE_SEO_TOOL_URL`/`VITE_FTP_TOOL_URL`. Internal service connections continue to use loopback ports. Production tools now enforce main administrator account authentication through `tools/tool-auth.js`. Set `NODE_ENV=production` and the actual `BACKEND_PORT` (5108 on this deployment), keep one fork instance per tool, and verify protection before exposing a reverse proxy. Never switch to development mode to bypass production configuration checks.

After `pm2 save`, check both `systemctl is-enabled pm2-root` and `systemctl is-active pm2-root`. If the correct PM2 unit exists but is inactive, inspect its Node path and `PM2_HOME`, then start it with `systemctl start pm2-root`. An enabled unit alone does not prove that systemd is currently supervising PM2. Do not restart the entire server just to test this on a machine hosting other sites.

The non-publishing production check is:

```sh
node deploy/verify-production.cjs https://admin.example.com https://seo-admin.example.com https://ftp-admin.example.com /root/admin-check.json
```

The private JSON file contains the main administrator `email` and `password`. Keep it outside the web root with mode `600`, and never commit it. A separate Basic-auth credential file is no longer required. The check validates HTTPS redirects, visible login pages, anonymous API rejection, account login, site access, navigation, model status, the authenticated SEO-to-FTP bridge, and session revocation after logout. Its only writes are authentication-session operations. It does not call a model, scan a website, publish content or upload through FTP, and does not replace real browser or business workflow checks.

### Tool access migration, 2026-09-12

The embedded browser could not display the old BaoTa Basic-auth challenge and reported `ERR_INVALID_AUTH_CREDENTIALS`, even though the loopback services and HTTPS proxies worked. Both tools now provide `/_tool-auth/login` forms using the main administrator's full email and password. SEO and FTP use separate host-only sessions; this is shared account authentication, not automatic single sign-on. Model pages share the SEO session. Open `/_tool-auth/login` while signed in to log out of that tool.

Before removing an old `PbootTools /` rule, back up the two tool servers and proxy configs, deploy the shared module and both guarded servers, restart only the two tools, and verify both loopback login pages return 200 and anonymous `/api/config` returns 401. Then use BaoTa **Website > Reverse proxy > the exact SEO or FTP project > Global configuration > HTTP authentication** to remove only that replaced rule. Preserve TLS, proxy targets and all unrelated sites. Validate Nginx and actual browser logins. Do not remove protection from old unguarded code. Rollback must restore proxy protection before restoring an old tool server.

The current gate uses an opaque `__Host-pboot_tool_session` cookie with Secure, HttpOnly, SameSite=Lax and no Domain. Sessions last at most eight hours, are lost on that tool's restart, and are revalidated against `/auth/profile`; the backend JWT expiry can shorten their lifetime. Cookie-authenticated writes require the exact tool Origin. Backend downtime fails closed. The SEO-to-FTP bridge forwards the validated identity only to loopback APIs. Credentials are not written into URLs, tutorial media or logs.

Actual browser testing caught an additional form issue: `Referrer-Policy: no-referrer` caused a native POST form to send `Origin: null`, while the CLI test sent an explicit Origin and passed. The response now uses `strict-origin-when-cross-origin`; refresh the login page after updating. Keep the strict Origin validation, and never allow `null` as a workaround. See [MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

This server's pre-migration backup is `/www/backup/pboot-tool-auth-before-20260912033506857/before.tgz`. The `deploy/install-tool-auth-update.cjs` migration intentionally checks the original source fingerprints; it is not an idempotent installer for arbitrary versions. Current acceptance includes Nginx validation, 17 authentication/verifier tests, production endpoint checks, and actual internal-browser SEO, models, model configuration and FTP pages. Missing model keys and unconfigured remote FTP remain separate business setup tasks. No scans, model requests or transfers were initiated.

## In-app deployment tutorial

The authenticated route `/#/deployment-tutorial` is linked from the top tool navigation. It contains the practical deployment walkthrough, searchable chapters, screenshot annotations, an image viewer, local-only checklists, Markdown download and printing. Checklist state never executes commands or changes the server.

Edit `frontend/src/content/deployment-guide.json` and `deployment-media.json`, then run `node deploy/build-tutorial-assets.cjs`. The generator copies only the explicitly reviewed screenshots into `frontend/public/tutorial/deployment`, generates SVG diagrams, and rebuilds the Chinese Markdown guide. Do not put credentials or private terminal output into the media list. Historical JPEG captures with a `.png` source filename are published with the correct `.jpg` extension, without altering image bytes.

Run `node --test deploy/tutorial-content.test.cjs tools/public-navigation.test.cjs deploy/fresh-install-ui.test.cjs`, build the frontend, then run `node deploy/tutorial-browser-check.cjs`. The browser check uses isolated mocked APIs and never writes business data. Its screenshots are local test evidence, not proof of production deployment.

The 2026-09-12 Chinese-domain investigation found two separate issues: the BaoTa rewrite file was empty, and PbootCMS returned a domain-authorization error behind the short Nginx 404 page. The single-site configuration was backed up outside the web root, and the official root-installation rules were saved through BaoTa. See `deploy/nginx/pboot-rewrite.conf`; do not use it for a subdirectory installation without adapting the prefix, or add a duplicate `location /`.

The owner then supplemented the official authorization for `cn.shanbo-rig.com`. Nginx syntax validation passed. HTTPS checks returned 200 for the main home page, Chinese home page, clean product-list/product-detail/news-detail routes and admin home; `/data/` remained 404. The internal browser also verified Chinese pages. The existing compatibility URL generation (`/?category/`) was intentionally retained: switching PB to generate clean links is a separate step requiring pagination, search, canonical and sitemap checks. Other language domains have not been accepted as working merely because CN works.

The tutorial's "语言域名与 Nginx 修复" chapter includes actual before/after screenshots and arrows, a per-language checklist, and rollback guidance. It records domain bindings, root directory, empty/saved rewrite rules, configuration backup, application authorization error and final HTTP verification. No license strings, credentials, content changes or GitHub push were included.

## Default ports

- Backend API: `http://localhost:5108`
- Management frontend: `http://localhost:5278`
- SEO tool: `http://localhost:5388`
- FTP tool: `http://localhost:5389`
