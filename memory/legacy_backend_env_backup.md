# Legacy FastAPI backend `.env` — archived on cleanup

The `/app/backend_legacy_fastapi/` directory was removed during cleanup
because the app fully migrated to Supabase. These environment variables
are preserved here for reference only. The active equivalents now live in
Supabase Vault / Edge function secrets.

```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
JWT_SECRET="anam-mma-7f3d9c2e8b1a4f6d9e0c5a7b3d8f1e4c"
JWT_ALGORITHM="HS256"
ADMIN_EMAIL="stevie@aipnua.com"
ADMIN_PASSWORD="AnamAdmin2026!"
SENDGRID_API_KEY="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"
SENDER_EMAIL="Anam@aipnua.ie"
```

Admin credentials are also tracked in `/app/memory/test_credentials.md`.
