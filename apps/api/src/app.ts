import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { config } from "./config.js";

/**
 * Build the Express app. Routes are mounted here as epics land:
 *   /auth, /accounts, /transactions, /anomalies, /query, /fdx, /webhooks
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true, // httpOnly auth cookies
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ level: config.NODE_ENV === "test" ? "silent" : "info" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "clarifi-api", version: "1.1.0" });
  });

  return app;
}
