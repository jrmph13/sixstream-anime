# 6stream Scraper API

6stream is a Node.js/Express scraper API with a built-in web player UI. It serves anime content from the configured anime scraper, includes proxy helpers for HLS/MP4 playback, and protects API access with a remote allowlist.

## Features

- Anime browsing, search, genres, details, episodes, servers, and video sources.
- Custom player UI with play/pause, mute, volume, progress, speed, fullscreen, subtitle selector, Sub/Dub badges, and 6stream watermark.
- Load more, pagination, carousel, skeleton loaders, responsive layout, and mobile-friendly controls.
- CORS/API gate based on a private server-side access list.
- HLS proxy and Pixeldrain proxy routes for cleaner playback/download flow.

## Requirements

- Node.js 18+ recommended.
- npm.
- Render account if deploying to Render.

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

API docs:

```text
http://localhost:3000/api
```

## Access Control

API access is controlled by a server-side allowlist loaded from `ACCESS_LIST_URL`.

Default behavior:

- The app reads the allowlist on server start.
- The app refreshes the allowlist every 5 minutes.
- The access-list URL is not exposed to the frontend.
- Requests without an allowed `Origin` or `Referer` are blocked for `/api` routes.
- Blocked requests return `403`.

Set this environment variable in production:

```bash
ACCESS_LIST_URL=<your_raw_access_txt_url>
```

Example `access.txt` format:

```text
https://your-domain.com/
https://your-preview.vercel.app/
http://localhost:3000/
```

Important: CORS is browser protection. Tools like Postman can spoof headers, so use signed tokens or API keys if you need stronger protection.

## Render Deployment

Render is the recommended host for this project because it runs as a long-lived Express server. That fits the scraper/proxy routes better than short serverless functions.

This repo includes `render.yaml`, so you can deploy as a Render Blueprint.

### Option 1: Blueprint

1. Push this repo to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Select this repository.
4. Render will read `render.yaml`.
5. Set `ACCESS_LIST_URL` in Render environment variables.
6. Deploy.

### Option 2: Manual Web Service

Create a Render Web Service with:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /
```

Environment variables:

```bash
NODE_ENV=production
ACCESS_LIST_URL=<your_raw_access_txt_url>
```

After Render gives you a domain, add it to your `access.txt` allowlist:

```text
https://your-render-app.onrender.com/
https://6stream.onrender.com/
https://sixstream.onrender.com/
```

Wait up to 5 minutes for the app to refresh the allowlist, or restart the Render service.

## Vercel Deployment

This project is an Express server, so deploy it as a Node.js serverless entry. If your Vercel project does not detect the server automatically, add a `vercel.json` like this:

```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "server.js" }
  ]
}
```

Deploy:

```bash
npm install -g vercel
vercel
vercel --prod
```

Recommended Vercel environment variables:

```bash
ACCESS_LIST_URL=<your_raw_access_txt_url>
NODE_ENV=production
```

After deployment, add your production domain to `access.txt`, for example:

```text
https://6stream.vercel.app/
```

Then wait up to 5 minutes, or redeploy/restart the serverless function so the new allowlist is loaded.

## Hosting Notes

Some routes use Puppeteer and FFmpeg-style processing. These are heavier than standard JSON API routes and may hit Vercel serverless cold-start, memory, or timeout limits depending on your plan and traffic.

Render, Railway, Fly.io, or a VPS are better fits for the API because the server can stay warm and keep browser/session state longer.

## API Routes

### Core

```text
GET /api
GET /api/all
GET /api/proxy?url=<encoded_url>
GET /api/hls?url=<encoded_m3u8_url>
```

### Anime

```text
GET /api/home
GET /api/latest?page=1
GET /api/popular?page=1
GET /api/search?q=<query>
GET /api/genres
GET /api/genre/:genreId?page=1
GET /api/type/:type?page=1
GET /api/status/:status?page=1
GET /api/anime/:slug
GET /api/anime/:slug/episodes
GET /api/servers?key=<serverKey>
GET /api/source/:linkId
GET /api/sources/:slug/:epNum
GET /api/player?url=<player_url>
GET /api/play/:slug/:epNum
```

Anime watch flow:

```text
1. GET /api/anime/:slug
2. GET /api/anime/:slug/episodes
3. GET /api/servers?key=<episode_server_key>
4. GET /api/source/:linkId
5. Play returned HLS/MP4 source through the custom player.
```

## Frontend Files

- `test.html` - main UI and custom player.
- `index.html` - alternate/static frontend file.
- `mapper.js` - client-side mapping helpers.
- `comment.js` - comment-related script.

## Backend Files

- `server.js` - Express app, API routes, proxies, CORS/access gate.
- `scraper.js` - anime scraper functions.
- `playerScraper.js` - player/source scraping helper.

## Troubleshooting

### API returns 403

Add your domain to the allowlist file and wait for refresh.

Check that requests are coming from an allowed `Origin` or `Referer`.

### Vercel works locally but fails in production

Check Vercel function logs:

```bash
vercel logs <deployment-url> --follow
```

Puppeteer and FFmpeg routes may need more memory/time than your Vercel plan allows.

### Video source does not play

Try another server/source if available. Some upstream providers block direct access or require proxying through `/api/hls`.

### Subtitles do not appear

Subtitle selector only appears when the selected source includes subtitle tracks. English is selected automatically when an English track is available.

## Scripts

```bash
npm start
npm run dev
```

## License

Private project. Add a license before publishing publicly.
