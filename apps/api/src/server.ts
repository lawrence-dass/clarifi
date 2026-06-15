import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`clarifi-api listening on http://localhost:${config.API_PORT}`);
});
