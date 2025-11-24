## ⚡ FlashShare: Ephemeral File Sharing Service

FlashShare is a secure, self-destructing file transfer service designed for sharing sensitive, short-lived data (like API keys, configuration files, or tokens) without persistent history.

Data is automatically and permanently purged from the server after either one successful download or 24 hours, whichever comes first.

🌟 Features

- **Ephemeral Data:** Files are designed to "burn after reading."
- **Single-Use Links:** Files are permanently deleted after the first successful download.
- **Time-Based Expiration:** Automated hourly cron job sweeps and deletes any files older than 24 hours.
- **Simple REST API:** Dedicated endpoints for upload and secure download/retrieval.
- **Cross-Origin Ready:** Configured with CORS for separate frontend deployment.
