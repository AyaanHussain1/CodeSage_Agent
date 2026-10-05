# Deploying the CodeSage web app

The Vercel deployment should contain only the static frontend in `web-app/`.
The Python API in `backend/server.py` is a separate service: it uses FastAPI,
OpenAI, uploaded files, and a disk-backed FAISS index. Deploy that API to a
Python-capable host and keep `OPENAI_API_KEY` configured there, not in Vercel
frontend settings or browser code.

## Deploy the frontend to Vercel

1. Import this GitHub repository into Vercel.
2. Set **Root Directory** to `web-app`.
3. Leave the framework preset as **Other** and deploy the static site.

No Python build command is needed for the frontend.

## Connect the frontend to the API

The production API URL currently defaults to the URL in `web-app/app.js`.
For a different backend, set `window.CODESAGE_API_URL` before `app.js` is
loaded in `web-app/index.html`:

```html
<script>
  window.CODESAGE_API_URL = "https://your-python-api.example.com";
</script>
<script src="app.js"></script>
```

Use the backend origin only (no endpoint path). The frontend removes trailing
slashes automatically. For local development, `localhost` uses
`http://localhost:8000`.

Configure the backend host with `OPENAI_API_KEY`. Project chat uses
`gpt-4o-mini` by default; set `OPENAI_MODEL` on the backend to choose another
compatible OpenAI chat model. The API loads a local `.env` for development;
never commit that file or put the key in frontend JavaScript.
If indexing fails, check the browser's Network tab for the failing request and
the Python service logs. A 404 on an address containing `//upload_project` or
`//index_project` indicates a malformed API base URL; a server error mentioning
the OpenAI key means the backend environment variable is missing or invalid.

## Important storage limitation

Uploads and FAISS indexes are stored on the API server's local disk. The
backend must keep that disk available between the upload, index, and chat
requests. Restarts, ephemeral storage, or multiple API instances can make an
uploaded project unavailable; durable multi-instance deployment needs shared
storage or a persistent vector database.
