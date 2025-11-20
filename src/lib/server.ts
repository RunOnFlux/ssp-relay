import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import routes from '../routes';

const nodeEnv = process.env.NODE_ENV;

const app = express();

app.set('trust proxy', 1);

if (nodeEnv !== 'test') {
  app.use(morgan('combined'));
}

const limiter = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 120, // Limit each IP to 120 requests per windowMs
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));
app.use(compression());
app.use(cors());
app.use(limiter);
routes(app);

// Catch-all route for undefined routes
app.use((_req, res) => {
  res.status(404).send('Not found.');
});

export default app;
