import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const {
  PORT = 8787,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  FRONTEND_URL = 'http://localhost:8000'
} = process.env;

const app = express();
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

// Allow browser requests from any local origin (e.g., localhost/127.0.0.1)
app.use(cors({ origin: true, credentials: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Fetch donors
app.get('/api/donors', async (_req, res) => {
  try {
    if (!supabase) {
      return res.status(200).json([]);
    }
    const { data, error } = await supabase
      .from('donors')
      .select('name, amountUsd:amountusd, message, date, social_x, social_tiktok, social_instagram, social_youtube, social_twitch')
      .order('date', { ascending: false })
      .limit(1000);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/donors', err);
    res.status(500).json({ error: 'failed_to_fetch_donors' });
  }
});

// Create Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(400).json({ error: 'stripe_not_configured' });
    const { name, amountUsd, message, socialX, socialTiktok, socialInstagram, socialYoutube, socialTwitch } = req.body || {};
    const amount = Number(amountUsd);
    if (!name || !amount || amount < 1) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    // Basic content moderation: block racist/offensive content
    const banned = getBannedChecker();
    if (banned(name) || banned(message || '')) {
      return res.status(400).json({ error: 'offensive_content' });
    }
    const commonMeta = {
      donor_name: String(name).slice(0, 120),
      donor_message: String(message || '').slice(0, 500),
      social_x: String(socialX || '').slice(0, 200),
      social_tiktok: String(socialTiktok || '').slice(0, 200),
      social_instagram: String(socialInstagram || '').slice(0, 200),
      social_youtube: String(socialYoutube || '').slice(0, 200),
      social_twitch: String(socialTwitch || '').slice(0, 200)
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Million Dollar Dummy Donation' },
            unit_amount: Math.round(amount * 100)
          },
          quantity: 1
        }
      ],
      metadata: commonMeta,
      payment_intent_data: { metadata: commonMeta },
      allow_promotion_codes: false,
      success_url: `${FRONTEND_URL}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/?canceled=1`
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('POST /api/create-checkout-session', err);
    res.status(500).json({ error: 'failed_to_create_session' });
  }
});

// Confirm session (no-CLI/no-webhook local fallback)
app.post('/api/confirm', async (req, res) => {
  try {
    if (!stripe || !supabase) {
      return res.status(400).json({ error: 'not_configured' });
    }
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'missing_session_id' });
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'not_paid' });
    }
    // Also fetch PaymentIntent metadata for reliability
    let piMeta = {};
    try {
      if (session.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
        piMeta = (pi && pi.metadata) || {};
      }
    } catch {}
    let name = session.metadata?.donor_name || 'Anonymous Dummy';
    let message = session.metadata?.donor_message || '';
    const amountUsd = Math.round(Number(session.amount_total || 0) / 100);
    const date = new Date().toISOString();
    // Sanitize again before inserting
    const banned = getBannedChecker();
    if (banned(name)) name = 'Anonymous Dummy';
    if (banned(message)) message = '';
    const payloadBase = { name, amountusd: amountUsd, message, date };
    const metaSocials = {
      social_x: session.metadata?.social_x || piMeta.social_x || null,
      social_tiktok: session.metadata?.social_tiktok || piMeta.social_tiktok || null,
      social_instagram: session.metadata?.social_instagram || piMeta.social_instagram || null,
      social_youtube: session.metadata?.social_youtube || piMeta.social_youtube || null,
      social_twitch: session.metadata?.social_twitch || piMeta.social_twitch || null
    };
    const clientSocials = (req.body && req.body.socials) || {};
    const mergedSocials = {
      social_x: metaSocials.social_x || clientSocials.socialX || null,
      social_tiktok: metaSocials.social_tiktok || clientSocials.socialTiktok || null,
      social_instagram: metaSocials.social_instagram || clientSocials.socialInstagram || null,
      social_youtube: metaSocials.social_youtube || clientSocials.socialYoutube || null,
      social_twitch: metaSocials.social_twitch || clientSocials.socialTwitch || null
    };
    let insertPayload = { ...payloadBase, ...mergedSocials };
    let { data, error } = await supabase.from('donors').insert([insertPayload]).select().single();
    if (error && String(error.message || '').includes('column')) {
      // Fallback if social columns are not created yet
      const { data: d2, error: e2 } = await supabase.from('donors').insert([payloadBase]).select().single();
      if (e2) throw e2;
      data = d2;
    } else if (error) {
      throw error;
    }
    res.json(data);
  } catch (err) {
    console.error('POST /api/confirm', err);
    res.status(500).json({ error: 'confirm_failed' });
  }
});

// Webhook needs raw body to verify signature
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !supabase || !STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('not_configured');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const name = session.metadata?.donor_name || 'Anonymous Dummy';
      const message = session.metadata?.donor_message || '';
      const amountUsd = Math.round(Number(session.amount_total || 0) / 100);
      const date = new Date().toISOString();
      const { error } = await supabase
        .from('donors')
        .insert([{ name, amountusd: amountUsd, message, date }]);
      if (error) throw error;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    res.status(500).send('webhook_handler_error');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// --- Content moderation helpers ---
function getBannedChecker() {
  const WORDS = [
    'nigger','nigga','chink','spic','wetback','kike','fag','faggot','tranny','retard','retarded',
    'coon','gook','porchmonkey','jigaboo','zipperhead','raghead','sandnigger','towelhead',
    'whitepower','white supremacy','heilhitler','siegheil','gas the jews','kill all jews',
    'lynch','monkey person','go back to','great replacement',
    'fuck','motherfucker','cunt'
  ];
  const map = { '0':'o','1':'i','!':'i','3':'e','4':'a','@':'a','$':'s','5':'s','7':'t','+':'t' };
  function norm(s = '') {
    s = String(s).toLowerCase().replace(/[0-9!3@4$57+]/g, (m) => map[m] || '');
    const spaced = ` ${s.replace(/[\W_]+/g, ' ').trim()} `;
    const nospace = spaced.replace(/\s+/g, '');
    return { spaced, nospace };
  }
  return function isBanned(input) {
    if (!input) return false;
    const { spaced, nospace } = norm(input);
    return WORDS.some(term => {
      const t = term.toLowerCase();
      return spaced.includes(` ${t} `) || nospace.includes(t.replace(/\s+/g,''));
    });
  };
}