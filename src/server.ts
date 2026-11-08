import { createApp } from "./app";
import { config } from "./config";
import { expireListings } from "./listings/service";

createApp().listen(config.PORT, () => {
  console.log(`Cone API listening on port ${config.PORT}`);
});

// Mark listings past their expiry date as expired, now and every 10 minutes.
const runExpiry = () => {
  expireListings().catch((err) => console.error("Expiry job failed", err));
};
runExpiry();
setInterval(runExpiry, 10 * 60 * 1000).unref();
