## Million Dollar Dummy - Static Site

A professional, simple landing page for the social experiment: how many dummies will it take to raise $1,000,000 at $1 or more each? Donors join the Wall of Dummies with their name, amount, date, and message.

### Features
- Live progress bar towards the $1,000,000 goal
- Prominent "Donate Now" CTA
- Wall of Dummies (name, amount, date, message) rendered from `data/donors.json`
- Responsive, accessible, lightweight (no build step)
- Optional demo donation modal to preview UX before wiring payments

### Quick Start
1. Open `index.html` in a browser, or serve the folder with any static web server.
   - macOS: `python3 -m http.server` then visit `http://localhost:8000`
2. Edit `js/app.js`:
   - Set `goalUsd` if you want a different target.
   - Replace `stripePaymentLink` with your Stripe Payment Link to accept real donations.
   - Set `enableDemoDonations` to `false` once real payments are enabled.
3. Update `data/donors.json` with real donations (or wire an automated backend; see below).

### Accepting Payments
You have two recommended paths:

1) Payment Link (simplest)
- Create a Stripe Payment Link for “Pay what you want” with min $1.
- Paste the URL into `js/app.js` → `stripePaymentLink`.
- After payments, you’ll need to add donors to `data/donors.json` (manual or scripted export).

2) Stripe Checkout + Webhook (automated)
- This repo includes a minimal Node server in `server/` that does all of this for you:
  - POST `/api/create-checkout-session` creates a Stripe Checkout Session for the amount the user enters (metadata stores name/message).
  - POST `/api/webhook` verifies Stripe signature and inserts a donor row.
  - GET `/api/donors` returns donors for the wall.
  - Storage: Supabase table `donors` with columns: `name text`, `amountUsd int`, `message text`, `date timestamptz`.
- Frontend is already wired to:
  - Load donors from `/api/donors` (falls back to `data/donors.json` if the server isn't running).
  - Submit donations via the modal -> server -> Stripe Checkout.

### Backend Setup (Stripe + Supabase)
1. Create a Supabase project.
2. SQL for donors table:
   ```sql
   create table if not exists donors (
     id bigint generated always as identity primary key,
     name text not null,
     amountUsd int not null,
     message text,
     date timestamptz not null default now()
   );
   ```
3. In Supabase Project Settings → API: copy Project URL and Service Role Key.
4. In Stripe:
   - Create a test secret key.
   - Add a webhook endpoint pointing to `http://localhost:8787/api/webhook` for event `checkout.session.completed`.
   - Copy the signing secret.
5. Create a `.env` file in `server/` (see `ENV_SAMPLE.txt`) and fill:
   - `FRONTEND_URL=http://localhost:8000`
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...`
   - `SUPABASE_URL=...`
   - `SUPABASE_SERVICE_KEY=...`
6. Install deps and run the server (from `server/`):
   ```bash
   npm install
   npm run dev
   ```
7. Serve the frontend (from repo root):
   ```bash
   python3 -m http.server 8000
   ```
Open `http://localhost:8000` and you can donate in test mode; completed donations appear automatically on the wall.

Example webhook payload mapping (conceptual):
```json
{
  "name": "Jane Dummy",
  "amountUsd": 5,
  "message": "I did it for science",
  "date": "2026-02-03T17:00:00.000Z"
}
```

### File Structure
```
.
├─ index.html
├─ styles.css
├─ js/
│  └─ app.js
├─ data/
│  └─ donors.json
└─ assets/
   └─ favicon.svg
```

### Customization
- Branding: update logo in `assets/favicon.svg` and the brand text in `index.html`.
- Colors/typography: adjust CSS variables at the top of `styles.css`.
- Copy: edit hero text, footer text, and empty state messaging in `index.html`.

### Deployment
- GitHub Pages, Vercel, Netlify, Cloudflare Pages, or any static host.
- Domain: point `milliondollardummy.com` DNS (A/AAAA or CNAME) to your host provider per their docs.

### Accessibility
- Landmarks, labels, and progress `aria` attributes are included.
- High color contrast and focus outlines are enabled by default.

### Notes
- `data/donors.json` is for demo/local use. For production, prefer a database and API.
- The demo donation modal is non-transactional and only updates the page state in-memory.

