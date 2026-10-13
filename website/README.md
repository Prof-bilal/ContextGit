# Website

The Next.js package contains ContextGit's marketing site only. It does not
contain the Tauri workbench or the backend API client.

## Development

```bash
npm install --prefix website
npm run dev --prefix website
```

The site runs at `http://localhost:3000`.

## Checks

```bash
npm run typecheck --prefix website
npm run build --prefix website
```

Routes are implemented in `app/`, reusable marketing components live in
`components/`, and website content/configuration helpers live in `lib/`.
Marketing planning documents are in [`../docs/marketing/`](../docs/marketing/).
