import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import compression from 'compression';
import routes from '../routes';

const nodeEnv = process.env.NODE_ENV;

const app = express();

if (nodeEnv !== 'test') {
  app.use(morgan('combined'));
}

app.use(compression());
app.use(cors());
routes(app);

export default app;
