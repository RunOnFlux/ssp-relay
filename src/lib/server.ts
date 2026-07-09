import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import config from 'config';
import routes from '../routes';
import { errorHandler, notFoundHandler, timeoutHandler } from './errorHandler';
import serviceHelper from '../services/serviceHelper';

const app = express();

// Relay version, resolved once at startup for the health probe. Read from disk
// (not a JSON import) so it stays accurate regardless of how the process is
// launched; cosmetic, so any failure falls back to 'unknown'.
let relayVersion = 'unknown';
try {
  const pkgPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../package.json',
  );
  relayVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? 'unknown';
} catch {
  // Non-fatal.
}

// Number of proxy hops in front of this service. Default 1 (single nginx /
// ALB). Override via TRUST_PROXY env (e.g. "2" for nginx behind Cloudflare,
// or a CIDR range string for finer control). Misconfiguring this collapses
// every client into the proxy's own IP and breaks per-IP rate limiting.
const trustProxyEnv = process.env.TRUST_PROXY;
const trustProxyValue = trustProxyEnv
  ? /^\d+$/.test(trustProxyEnv)
    ? Number(trustProxyEnv)
    : trustProxyEnv
  : 1;
app.set('trust proxy', trustProxyValue);

// Request logging
app.use(
  morgan(
    ':date[iso] :remote-addr :method :url :status :res[content-length] - :response-time ms',
  ),
);

// Request timeout middleware
app.use(timeoutHandler(30000)); // 30 second timeout

// Stripe webhook route — MUST be before JSON body parser so raw body is preserved
// for signature verification. Registered here, not in routes.ts.
//
// Per-route rate limit: real Stripe delivery is rare (a few events per user
// action); anything above this burst is very likely a forged-payload flood.
// Signature verification will reject forgeries, but the limiter caps CPU/log
// cost before we ever call `stripe.webhooks.constructEvent`. Capped raw body
// size defensively (Stripe events are <10KB typical).
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
app.post(
  '/v1/enterprise/stripe/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '15mb' }),
  async (req, res) => {
    try {
      const enterpriseHooks = (await import('../services/enterpriseHooks'))
        .default;
      if (!enterpriseHooks.isLoaded()) {
        res.status(503).json({ error: 'Enterprise module not loaded' });
        return;
      }
      const result = await enterpriseHooks.stripeWebhook(req);
      if (result.success) {
        res.json({ received: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err) {
      console.error('Stripe webhook error:', err);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  },
);

// security.txt (RFC 9116) — vulnerability disclosure pointer served on the
// relay's own domain so researchers scanning relay.sspwallet.com find it too.
// Static text only, no business logic. Registered before the rate limiter so a
// scanner never gets a 429 on a disclosure file. The PGP key is hosted once on
// the website (single source of truth); Encryption points there.
const SECURITY_TXT = [
  '# SSP Relay — Security Policy',
  '# https://relay.sspwallet.com/.well-known/security.txt',
  '#',
  '# SSP is developed by InFlux Technologies (RunOnFlux). Security',
  '# vulnerabilities are handled through the Flux Bug Bounty Program. Please',
  '# report responsibly and encrypt sensitive details with the PGP key below.',
  '',
  'Contact: mailto:security@runonflux.com',
  'Policy: https://runonflux.com/bug-bounty/',
  'Acknowledgments: https://runonflux.com/bug-bounty/',
  'Encryption: https://sspwallet.com/.well-known/pgp-key.txt',
  'Preferred-Languages: en',
  'Canonical: https://sspwallet.com/.well-known/security.txt',
  'Canonical: https://relay.sspwallet.com/.well-known/security.txt',
  'Expires: 2027-07-08T00:00:00.000Z',
  '',
].join('\n');
app.get(['/.well-known/security.txt', '/security.txt'], (_req, res) => {
  res.type('text/plain').send(SECURITY_TXT);
});

// Health / readiness probe. Public and unauthenticated (monitors and the status
// page hit it), registered before the rate limiter so probes are never
// throttled. 200 when the process is up and MongoDB answers a ping within 2s;
// 503 (status:'degraded') if the DB is unreachable so uptime monitors can page.
app.get(['/health', '/v1/health'], async (_req, res) => {
  const health: {
    status: 'ok' | 'degraded';
    version: string;
    uptime: number;
    timestamp: string;
    db: 'connected' | 'disconnected';
  } = {
    status: 'ok',
    version: relayVersion,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    db: 'disconnected',
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const dbClient = await serviceHelper.databaseConnection();
    const database = dbClient.db(config.database.database);
    await Promise.race([
      database.command({ ping: 1 }),
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('db ping timeout')),
          2000,
        );
      }),
    ]);
    health.db = 'connected';
  } catch {
    health.status = 'degraded';
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// Body parsing middleware
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false, limit: '15mb' }));
app.use(express.text({ limit: '15mb' }));

// Compression
app.use(compression());

// CORS
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 120, // Limit each IP to 120 requests per windowMs
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
app.use(limiter);

// Routes
routes(app);

// 404 handler
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
