import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  })
);
app.use(express.json({ limit: "100kb" }));

// Health check for monitoring and deployment.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Cone API listening on port ${port}`);
});
