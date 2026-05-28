# Deployment

For local development, the app reads `.env.local`. On Render, that file is not used, so you must add the same values in the Render dashboard or use `render.yaml`.

Required runtime env vars on Render:

- `DATABASE_URL` for Neon
- `DEEPSEEK_API_KEY` for chat generation
- `TAVILY_API_KEY` for live web search

Build and start commands used by Render:

```bash
npm install && npm run build
npm start
```

If the site loads locally but not online, the usual causes are:

1. The Render service is using the wrong type or start command.
2. The required env vars are missing in Render.
3. The database URL is pointing to a local database instead of Neon.

# maestro
# final
