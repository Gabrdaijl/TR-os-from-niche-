# TR-os

Browser desktop frontend with games, movies, AI, cloud launcher, themes and settings.

Serve this repository over HTTPS (or localhost for development). Keep all files and directories together at the site root. The proxy service worker needs its scope and proxy routes on the same origin.

## Backend services

This repository does not include the reference site's backend. Static hosting alone cannot implement its proxy, VPN, AI, shared chat or cloud gaming. Configure services you operate in `tr-os.config.js`:

- `apiBase`: HTTP API base; defaults to this origin. Required routes include `/online`, `/chat/*`, `/api/mullvad/*`, `/api/tmdb*` and `/cloud/v1/*`.
- `wispBase`: WebSocket server base; defaults to `apiBase`. It must provide the selected `/wisp-*/` routes and `/tros-ws`.
- `aiUrl`: AI relay; defaults to `/api/ai`. Supply provider credentials on the server, never in frontend files.

Cloud gaming additionally requires the provider's session service and a valid account/API key. Changing a hostname does not create those services.

The bundled proxy runtime and Scramjet runtime files are included. Their third-party notices remain in the source. This is a frontend repair and branding change; full backend parity has not been verified.
