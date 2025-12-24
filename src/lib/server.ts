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
