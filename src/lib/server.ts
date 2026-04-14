import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import routes from '../routes';
import { errorHandler, notFoundHandler, timeoutHandler } from './errorHandler';

const app = express();

app.set('trust proxy', 1);

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
app.post(
  '/v1/enterprise/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const enterpriseHooks = (await import('../services/enterpriseHooks')).default;
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

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

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
