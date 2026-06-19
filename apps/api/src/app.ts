import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { config } from "./config.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { accountsRouter } from "./modules/accounts/accounts.routes.js";
import { budgetsRouter } from "./modules/budgets/budgets.routes.js";
import { transactionsRouter } from "./modules/ingestion/ingestion.routes.js";
import { transactionsAnalyticsRouter } from "./modules/transactions/transactions.routes.js";
import { anomaliesRouter } from "./modules/anomaly/anomaly.routes.js";
import { queryRouter } from "./modules/nl-query/query.routes.js";
import { fdxRouter } from "./modules/fdx/fdx.routes.js";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes.js";
import { errorMiddleware } from "./middleware/error.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

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
  // pino-http first so req.log is attached before body parsing — a malformed or
  // oversized JSON body throws inside express.json, and the error handler needs
  // req.log to record it.
  app.use(pinoHttp({ level: config.NODE_ENV === "test" ? "silent" : "info" }));
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(cookieParser());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "clarifi-api", version: "1.1.0" });
  });

  app.use("/auth", authRouter);
  app.use("/accounts", accountsRouter);
  app.use("/budgets", budgetsRouter);
  app.use("/transactions", transactionsRouter);
  app.use("/transactions", transactionsAnalyticsRouter);
  app.use("/anomalies", anomaliesRouter);
  app.use("/query", queryRouter);
  app.use("/fdx", fdxRouter);
  app.use("/webhooks", webhooksRouter);

  // Central error handler — must be registered last, after all routes.
  app.use(errorMiddleware);

  return app;
}
