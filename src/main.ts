import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { CorsOptions } from '@nestjs/common/internal';
import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

function getCsrfSecret() {
  const secret = process.env.CSRF_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('CSRF_SECRET must be configured with at least 32 bytes');
  }
  return secret;
}

async function bootstrap() {
  const csrfSecret = getCsrfSecret();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(
    '/uploads',
    express.static(resolve(process.cwd(), 'uploads'), {
      dotfiles: 'deny',
      index: false,
      maxAge: '1d',
    }),
  );

  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      if (origin && allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    credentials: true,
  };

  app.enableCors(corsOptions);

  app.use((request: Request, response: Response, next: NextFunction) => {
    const origin = request.get('Origin');
    if (!origin || !allowedOrigins.includes(origin)) {
      response.status(403).json({ message: 'Origin not allowed' });
      return;
    }
    next();
  });

  app.use(cookieParser());

  const { doubleCsrfProtection } = doubleCsrf({
    cookieName: 'csrf_token',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      httpOnly: true,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
    getSecret: () => csrfSecret,
    getSessionIdentifier: (request) => request.ip || 'anonymous',
  });

  app.use(doubleCsrfProtection);
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      originAgentCluster: false,
      permittedCrossDomainPolicies: false,
      referrerPolicy: false,
      strictTransportSecurity: false,
      xContentTypeOptions: false,
      xDnsPrefetchControl: false,
      xDownloadOptions: false,
      xFrameOptions: false,
      xXssProtection: false,
    }),
  );

  await app.listen(process.env.PORT ?? 5000);
}
await bootstrap();
