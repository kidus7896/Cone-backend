import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { optionalAuth } from "./auth/middleware";
import { config } from "./config";
import { errorHandler } from "./lib/errors";
import { authRouter } from "./routes/auth";
import { catalogRouter } from "./routes/catalog";
import { listingsRouter } from "./routes/listings";
import { meRouter } from "./routes/me";
import { publicRouter } from "./routes/public";
import { adminRouter } from "./routes/admin";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use(helmet());
  app.use(
    cors({
      // "*" (allow any website) is accepted only outside production, for cloud test setups.
      origin:
        config.CORS_ORIGINS.trim() === "*" && config.NODE_ENV !== "production"
          ? true
          : config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    })
  );
  app.use(express.json({ limit: "100kb" }));

  // Health check for monitoring and deployment.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const api = express.Router();
  api.use(optionalAuth);

  // Per-IP limit on every auth endpoint. Per-phone limits live in the OTP service.
  api.use(
    "/auth",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          error: { code: "rate_limited", message: "Too many attempts. Try again later.", fields: {} },
        });
      },
    }),
    authRouter
  );
  api.use("/me", meRouter);
  api.use(catalogRouter);
  api.use("/listings", listingsRouter);
  api.use(publicRouter);
  api.use("/admin", adminRouter);

  app.use("/api/v1", api);

  // JSON 404 and the shared error format.
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found", fields: {} } });
  });
  app.use(errorHandler);

  return app;
}
