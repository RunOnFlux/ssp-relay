import { Request, Response, NextFunction } from 'express';
import log from './log';

/**
 * Custom application error class
 */
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler middleware
 * Should be placed as the last middleware in the chain
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Don't log errors in test environment
  if (process.env.NODE_ENV !== 'test') {
    log.error({
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      ip: req.ip,
    });
  }

  // Default error values
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';

  // Handle known error types
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code || 'APP_ERROR';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
    code = 'VALIDATION_ERROR';
  } else if (err.name === 'MongoError') {
    statusCode = 500;
    message = 'Database error';
    code = 'DATABASE_ERROR';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
    code = 'UNAUTHORIZED';
  }

  // Send error response
  res.status(statusCode).json({
    status: 'error',
    data: {
      code: statusCode,
      name: code,
      message: message,
      // Include stack trace only in development
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response) {
  log.warn(`Route not found: ${req.method} ${req.url}`);

  res.status(404).json({
    status: 'error',
    data: {
      code: 404,
      name: 'NOT_FOUND',
      message: 'The requested resource was not found',
    },
  });
}

/**
 * Timeout handler middleware
 */
export function timeoutHandler(timeoutMs = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        log.error(`Request timeout: ${req.method} ${req.url}`);

        res.status(408).json({
          status: 'error',
          data: {
            code: 408,
            name: 'TIMEOUT',
            message: 'Request timeout',
          },
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timeout));
    next();
  };
}

/**
 * Circuit breaker for external API calls
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold = 5,
    private timeout = 60000, // 1 minute
    private name = 'unknown',
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if we should try again
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
        log.info(`Circuit breaker entering half-open state: ${this.name}`);
      } else {
        throw new AppError(
          `Circuit breaker is open for ${this.name}`,
          503,
          'CIRCUIT_OPEN',
        );
      }
    }

    try {
      const result = await fn();

      // Success - reset if we were half-open
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
        log.info(`Circuit breaker closed: ${this.name}`);
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.threshold) {
        this.state = 'open';
        log.error(
          `Circuit breaker opened: ${this.name} (${this.failures} failures)`,
        );
      }

      throw error;
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }

  reset() {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
  }
}

export default {
  AppError,
  asyncHandler,
  errorHandler,
  notFoundHandler,
  timeoutHandler,
  CircuitBreaker,
};
