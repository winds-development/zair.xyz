import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getBotStatus } from "./lib/raze-bot";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) =>
        ["/", "/ping", "/status"].includes(req.url?.split("?")[0] ?? ""),
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Keep-alive + REAL status endpoints for Render / UptimeRobot.
// These report the actual Discord connection: 200 only when ZAIR is connected
// to the Discord gateway, 503 when the web server is up but the bot is not.
// (/api/healthz stays a plain "process is alive" check.)
function discordStatusHandler(_req: express.Request, res: express.Response) {
  const status = getBotStatus();
  res.status(status.ready ? 200 : 503).json({
    status: status.ready ? "online" : "discord-disconnected",
    discord: status,
    uptimeSeconds: Math.round(process.uptime()),
  });
}
app.get("/", discordStatusHandler);
app.get("/ping", discordStatusHandler);
app.get("/status", discordStatusHandler);

app.use("/api", router);

export default app;
