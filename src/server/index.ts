// src/server/index.ts
import "./utils/load-env";
import app from "./app";

const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
});
