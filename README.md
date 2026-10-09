# Returns Check

React + Vite dashboard. The visitor enters a customer phone number, the app calls your n8n webhook, and shows a Low / Medium / High risk result.

## Run it

```bash
npm install
cp .env.example .env     # then edit the values
npm run dev
```

Build for hosting (Vercel, Netlify, Cloudflare Pages): `npm run build`, then upload `dist/`.

## How the limit works

1. The app fetches the visitor's IP (api.ipify.org).
2. If `localStorage` already has that IP saved for today, it shows the "limit reached" message with your WhatsApp / Instagram / TikTok buttons. No webhook call.
3. Otherwise it saves `{ ip, date }`, then POSTs to n8n.
4. If the webhook fails, the saved record is removed so the visitor keeps their free check.

## n8n webhook contract

The app sends (POST, JSON):

```json
{ "phone": "01012345678", "ip": "41.x.x.x", "date": "2026-10-07" }
```

Your workflow should respond with JSON (use a "Respond to Webhook" node):

```json
{ "total_orders": 8, "cancelled_orders": 6, "delivered_orders": 2 }
```

Risk is computed in the app from the cancel rate: 50% or more is High, 25% to 49% is Medium, below 25% is Low, and zero orders is "No history".
Return HTTP 429 if you want to tell the app the limit is reached.

Set the webhook's allowed origins (CORS) to your site's domain in the n8n Webhook node options.

## Important: enforce the limit in n8n too

`localStorage` is easy to bypass (clear site data, private window). That is fine for a friendly nudge, but a determined visitor can check unlimited numbers. In n8n, count checks per `ip` per day (a Google Sheet, Airtable, or Redis lookup) and return 429 after the first one. Also keep your courier API key inside n8n only, never in this React app.
