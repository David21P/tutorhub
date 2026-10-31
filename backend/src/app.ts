import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { activeOnly, authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { accountRouter } from './routes/account';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { availabilityRouter } from './routes/availability';
import { bookingsRouter } from './routes/bookings';
import { categoriesRouter } from './routes/categories';
import { chatRouter } from './routes/chat';
import { filesRouter } from './routes/files';
import { offersRouter } from './routes/offers';
import { reportsRouter } from './routes/reports';
import { reviewsRouter } from './routes/reviews';
import { subscriptionsRouter } from './routes/subscriptions';
import { tutorsRouter } from './routes/tutors';
import { usersRouter } from './routes/users';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.frontendOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  // Rutas públicas: salud del servicio e inicio de sesión
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRouter);

  // Todo lo demás exige el JWT en el header Authorization
  const api = express.Router();
  api.use(authenticate);
  api.use('/account', accountRouter); // una cuenta suspendida solo llega hasta aquí (y a /auth/me)
  api.use(activeOnly);
  api.use('/users', usersRouter);
  api.use('/files', filesRouter);
  api.use('/categories', categoriesRouter);
  api.use('/tutors', tutorsRouter);
  api.use('/offers', offersRouter);
  api.use('/availability', availabilityRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/subscriptions', subscriptionsRouter);
  api.use('/chat', chatRouter);
  api.use('/reviews', reviewsRouter);
  api.use('/reports', reportsRouter);
  api.use('/admin', adminRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
