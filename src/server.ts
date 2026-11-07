import { createApp } from "./app";
import { config } from "./config";

createApp().listen(config.PORT, () => {
  console.log(`Cone API listening on port ${config.PORT}`);
});
