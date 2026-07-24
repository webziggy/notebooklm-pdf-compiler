---
name: auto_backup_on_commit
description: Ensures the project is backed up to Google Drive immediately after any git commit or release.
---

## Backup Trigger Workflow
- **Rule**: Whenever you successfully run a `git commit` or execute a project release on behalf of the user, you MUST immediately run the `./backup.sh` script to sync the new changes to the local Google Drive backup folder.
- Do not wait for the user to ask; execute it automatically as a post-commit routine step.
