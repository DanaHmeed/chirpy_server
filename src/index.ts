import express from "express";
import { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { BadRequestError } from "./errors.js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";

const migrationClient = postgres(config.db.url, { max: 1 });

await migrate(
  drizzle(migrationClient),
  config.db.migrationConfig
);

const app = express();
app.use(express.json());

app.use(middlewareLogResponses);

// API endpoints
app.get("/api/healthz", handlerReadiness);
app.use("/app", middlewareMetricsInc, express.static("./src/app"));
app.post ("/api/validate_chirp", handlerValidateChirp);

// Admin endpoints
app.get("/admin/metrics", handlerMetrics);
app.post("/admin/reset", handlerReset);
app.use(middlewareErrorHandler);

function middlewareLogResponses(
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.on("finish", () => {
    const statusCode = res.statusCode;

    if (statusCode < 200 || statusCode >= 300) {
      console.log(
        `[NON-OK] ${req.method} ${req.url} - Status: ${statusCode}`
      );
    }
  });

  next();
}

function middlewareMetricsInc(
  req: Request,
  res: Response,
  next: NextFunction
) {
  config.api.fileserverHits++;
  next();
}


function handlerReadiness(req: Request, res: Response) {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send("OK");
}

function handlerMetrics(req: Request, res: Response) {
  res.set("Content-Type", "text/html; charset=utf-8");

  res.send(`
<html>
  <body>
    <h1>Welcome, Chirpy Admin</h1>
    <p>Chirpy has been visited ${config.api.fileserverHits} times!</p>
  </body>
</html>
  `);
}

function handlerReset(req: Request, res: Response) {
  config.api.fileserverHits = 0;

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send("Hits reset to 0");
}

async function handlerValidateChirp(req: Request, res: Response) {
  const body = req.body.body;

  if (body.length > 140) {
throw new BadRequestError("Chirp is too long. Max length is 140");  }

  const profaneWords = ["kerfuffle", "sharbert", "fornax"];

  const words = body.split(" ");

  const cleanedWords = words.map((word: string) => {
    if (profaneWords.includes(word.toLowerCase())) {
      return "****";
    }

    return word;
  });

  const cleanedBody = cleanedWords.join(" ");

  res.status(200).json({
    cleanedBody,
  });
}

type HTTPError = Error & {
  statusCode?: number;
};

function middlewareErrorHandler(
  err: HTTPError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.log(err);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong on our end";

  res.status(statusCode).json({
    error: message,
  });
}

app.listen(config.api.port, () => {
  console.log(`Server is running on port ${config.api.port}`);
});