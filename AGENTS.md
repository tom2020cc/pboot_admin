# Project Workflow

## Development

- Work on the local management project first.
- Build and test locally before any deployment.
- Do not modify BaoTa, server configuration, or production files during local development unless the user explicitly requests deployment.
- Prefer minimal, targeted changes.
- Do not refactor unrelated modules.
- Investigate the root cause before modifying code.
- Prioritize files directly related to the current task.
- After changes, run only the tests or build checks necessary for the affected functionality.

## Deployment

- Deployment is a separate step from local development.
- Do not deploy automatically after completing local changes.
- Routine deployment should update source code only.
- Preserve each environment's:
  - databases
  - uploads
  - managed-sites configuration
  - secrets
  - `.env` and other environment files
- Do not modify BaoTa configuration unless explicitly requested.
- Keep PB website code and PB website databases outside the management-project deployment scope unless explicitly requested.

## Backup and Git

- Do not create code backups automatically.
- Do not push to GitHub automatically.
- Do not create commits automatically unless explicitly requested.
- Only perform backup, commit, or push operations when the user explicitly requests that specific operation.

## Documentation

- Document significant environment, deployment, database, architecture, or server configuration changes.
- Small routine UI or styling changes do not require a new tutorial or deployment document.

# Technology Stack

## Frontend

- Vue 3

## Backend

- NestJS

## Database

- SQLite

# Code Modification Rules

- Do not scan or inspect `node_modules`, `dist`, or `build` unless absolutely necessary for diagnosing the current issue.
- Do not upgrade npm packages or other dependencies unless explicitly requested.
- Make the smallest reasonable change required to complete the task.
- Do not refactor code unrelated to the current task.
- Database schemas, migrations, and existing table structures may be modified when needed for the current task. Investigate compatibility first, make the smallest necessary change, preserve existing data, and verify and document the result. Production changes must still follow the deployment authorization rules above.
- Preserve existing APIs and behavior unless the task explicitly requires changing them.
- Do not replace working implementations merely for stylistic reasons.
- Prefer fixing the root cause over adding temporary workarounds.

# Verification

- Verify the affected functionality after making changes.
- Run targeted checks first.
- Do not run unnecessary full-project tests, builds, or dependency installations.
- If a change may affect multiple modules, explain the impact before making a large-scale modification.
