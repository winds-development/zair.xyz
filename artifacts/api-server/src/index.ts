import app from "./app";
import { logger } from "./lib/logger";
import { getBotStatus, startRazeBot, stopRazeBot } from "./lib/raze-bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let shuttingDown = false;

// Never let a stray error silently kill (or silently freeze) the process.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection (process kept running)");
});
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "Uncaught exception (process kept running)");
});

// Render Web Service: bind to 0.0.0.0 on the PORT Render provides.
const server = app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "HTTP server listening on 0.0.0.0");
});

// Start the Discord bot in the same process.
// If login fails the process stays up so /status can show the reason; the
// watchdog below restarts the service if the bot is still offline after 3 min.
void startRazeBot().catch((error) => {
  logger.error({ err: error }, "ZAIR failed to start / log in to Discord");
});

// Watchdog: the website can stay "live" while the Discord gateway is dead.
// If the bot is not connected for 10 minutes straight, exit so Render restarts
// the service and logs in again. While Discord itself is rate limiting us we
// do NOT restart (each restart only makes the rate limit worse); we wait.
const notReadyLimitMs = 10 * 60_000;
let notReadySince: number | null = Date.now();
setInterval(() => {
  if (shuttingDown) {
    return;
  }
  const status = getBotStatus();
  if (status.ready) {
    notReadySince = null;
    return;
  }
  notReadySince ??= Date.now();
  if (Date.now() < status.rateLimitedUntil + 60_000) {
    return;
  }
  if (Date.now() - notReadySince > notReadyLimitMs) {
    logger.fatal(
      "ZAIR has not been connected to Discord for 10 minutes; exiting so Render restarts it",
    );
    process.exit(1);
  }
}, 30_000);

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Shutting down gracefully");

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  try {
    await stopRazeBot();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
  }
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
