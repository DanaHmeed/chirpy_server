import express from "express";
import { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { BadRequestError, NotFoundError } from "./errors.js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { createChirp, getAllChirps, getChirpById } from "./db/queries/chirps.js";
import { createUser, deleteAllUsers, getUserByEmail } from "./db/queries/users.js";
import {  hashPassword, checkPasswordHash} from "./auth.js";

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
app.post("/api/chirps", handlerCreateChirp);
app.post("/api/users", handlerCreateUser);
app.get("/api/chirps", handlerGetAllChirps);
app.get("/api/chirps/:chirpId", handlerGetChirpById);
app.post("/api/login", handlerLogin);
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

async function handlerReset(req: Request, res: Response) {
  if (config.api.platform !== "dev") {
    res.status(403).json({
      error: "Forbidden",
    });
    return;
  }

  config.api.fileserverHits = 0;

  await deleteAllUsers();

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send("Hits reset to 0");
}

async function handlerCreateChirp(req: Request, res: Response) {
  const { body, userId } = req.body;

  if (body.length > 140) {
    throw new BadRequestError(
      "Chirp is too long. Max length is 140"
    );
  }

  const profaneWords = ["kerfuffle", "sharbert", "fornax"];

  const words = body.split(" ");

  const cleanedWords = words.map((word: string) => {
    if (profaneWords.includes(word.toLowerCase())) {
      return "****";
    }

    return word;
  });

  const cleanedBody = cleanedWords.join(" ");

  const chirp = await createChirp({
    body: cleanedBody,
    userId,
  });

  res.status(201).json(chirp);
}
async function handlerGetAllChirps(req: Request, res: Response) {
  const chirps = await getAllChirps();

  res.status(200).json(chirps);
}

type HTTPError = Error & {
  statusCode?: number;
};

async function handlerCreateUser(
  req: Request,
  res: Response
) {
  const { email, password } = req.body;
  const hashedPassword = await hashPassword(password);
  const user = await createUser({
    email,
    hashedPassword,
  });
  const {
    hashedPassword: _,
    ...userResponse
  } = user;

  res.status(201).json(userResponse);
}

async function handlerGetChirpById(
  req: Request<{ chirpId: string }>,
  res: Response
) {
  const chirpId = req.params.chirpId;

  const chirp = await getChirpById(chirpId);

  if (!chirp) {
    throw new NotFoundError("Chirp not found");
  }

  res.status(200).json(chirp);
}

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

async function handlerLogin(
  req: Request,
  res: Response
) {
  const { email, password } = req.body;

  try {
    const user = await getUserByEmail(email);

    if (!user) {
      throw new Error("user not found");
    }

    const passwordMatches =
      await checkPasswordHash(
        password,
        user.hashedPassword
      );

    if (!passwordMatches) {
      throw new Error("incorrect password");
    }

    const {
      hashedPassword: _,
      ...userResponse
    } = user;

    res.status(200).json(userResponse);
  } catch {
    res.status(401).json({
      error: "incorrect email or password",
    });
  }
}


app.listen(config.api.port, () => {
  console.log(`Server is running on port ${config.api.port}`);
});