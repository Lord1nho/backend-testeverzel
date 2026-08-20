import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`HTTP server running on port ${env.PORT}`);
});
