import express from "express";
import { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { BadRequestError, NotFoundError,UnauthorizedError } from "./errors.js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { createChirp, getAllChirps, getChirpById, deleteChirp } from "./db/queries/chirps.js";
import { createUser, deleteAllUsers, getUserByEmail, updateUser, upgradeUserToChirpyRed } from "./db/queries/users.js";
import { hashPassword, checkPasswordHash, makeJWT, validateJWT, getBearerToken, makeRefreshToken, getAPIKey } from "./auth.js";
import {
  createRefreshToken,
  getUserFromRefreshToken,
  revokeRefreshToken,
} from "./db/queries/refreshTokens.js";

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
app.post("/api/refresh", handlerRefresh);
app.post("/api/revoke", handlerRevoke);
app.put("/api/users", handlerUpdateUser);
app.delete( "/api/chirps/:chirpId",handlerDeleteChirp);
app.post( "/api/polka/webhooks", handlerPolkaWebhook);
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

async function handlerCreateChirp(
  req: Request,
  res: Response
) {
  const { body } = req.body;

  let userId: string;

  try {
    const token = getBearerToken(req);

    userId = validateJWT(
      token,
      config.api.jwtSecret
    );
  } catch {
    throw new UnauthorizedError("Unauthorized");
  }

  if (body.length > 140) {
    throw new BadRequestError(
      "Chirp is too long. Max length is 140"
    );
  }

  const profaneWords = [
    "kerfuffle",
    "sharbert",
    "fornax",
  ];

  const words = body.split(" ");

  const cleanedWords = words.map(
    (word: string) => {
      if (
        profaneWords.includes(
          word.toLowerCase()
        )
      ) {
        return "****";
      }

      return word;
    }
  );

  const cleanedBody = cleanedWords.join(" ");

  const chirp = await createChirp({
    body: cleanedBody,
    userId,
  });

  res.status(201).json(chirp);
}

async function handlerGetAllChirps(
  req: Request,
  res: Response
) {
  const authorId = req.query.authorId;
  const sort = req.query.sort;

  const chirps = await getAllChirps(
    typeof authorId === "string"
      ? authorId
      : undefined
  );

  chirps.sort((a, b) => {
    const aTime = a.createdAt.getTime();
    const bTime = b.createdAt.getTime();

    if (sort === "desc") {
      return bTime - aTime;
    }

    return aTime - bTime;
  });

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
      throw new Error();
    }

    const passwordMatches =
      await checkPasswordHash(
        password,
        user.hashedPassword
      );

    if (!passwordMatches) {
      throw new Error();
    }

    // Access token: 1 hour
    const accessToken = makeJWT(
      user.id,
      60 * 60,
      config.api.jwtSecret
    );

    // Refresh token: random 256-bit string
    const refreshToken = makeRefreshToken();

    // Refresh token expires in 60 days
    const expiresAt = new Date(
      Date.now() +
        60 * 24 * 60 * 60 * 1000
    );

    await createRefreshToken(
      refreshToken,
      user.id,
      expiresAt
    );

    const {
      hashedPassword: _,
      ...userResponse
    } = user;

    res.status(200).json({
      ...userResponse,
      token: accessToken,
      refreshToken,
    });
  } catch {
    res.status(401).json({
      error: "incorrect email or password",
    });
  }
}
async function handlerRefresh(
  req: Request,
  res: Response
) {
  try {
    const token = getBearerToken(req);

    const result =
      await getUserFromRefreshToken(token);

    if (!result) {
      throw new Error();
    }

    const { user, refreshToken } = result;

    if (refreshToken.revokedAt) {
      throw new Error();
    }

    if (refreshToken.expiresAt < new Date()) {
      throw new Error();
    }

    const accessToken = makeJWT(
      user.id,
      60 * 60,
      config.api.jwtSecret
    );

    res.status(200).json({
      token: accessToken,
    });
  } catch {
    res.status(401).json({
      error: "Unauthorized",
    });
  }
}

async function handlerRevoke(
  req: Request,
  res: Response
) {
  const token = getBearerToken(req);

  await revokeRefreshToken(token);

  res.status(204).send();
}

async function handlerUpdateUser(
  req: Request,
  res: Response
) {
  let userId: string;

  try {
    const token = getBearerToken(req);

    userId = validateJWT(
      token,
      config.api.jwtSecret
    );
  } catch {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  const { email, password } = req.body;

  const hashedPassword =
    await hashPassword(password);

  const user = await updateUser(
    userId,
    email,
    hashedPassword
  );

  const {
    hashedPassword: _,
    ...userResponse
  } = user;

  res.status(200).json(userResponse);
}


async function handlerDeleteChirp(
  req: Request<{ chirpId: string }>,
  res: Response
) {
  let userId: string;

  try {
    const token = getBearerToken(req);

    userId = validateJWT(
      token,
      config.api.jwtSecret
    );
  } catch {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  const chirpId = req.params.chirpId;

  const chirp = await getChirpById(chirpId);

  if (!chirp) {
    res.status(404).json({
      error: "Chirp not found",
    });
    return;
  }

  if (chirp.userId !== userId) {
    res.status(403).json({
      error: "Forbidden",
    });
    return;
  }

  await deleteChirp(chirpId);

  res.status(204).send();
}
async function handlerPolkaWebhook(
  req: Request,
  res: Response
) {
  let apiKey: string;

  try {
    apiKey = getAPIKey(req);
  } catch {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  if (apiKey !== config.api.polkaKey) {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  const { event, data } = req.body;

  if (event !== "user.upgraded") {
    res.status(204).send();
    return;
  }

  const user = await upgradeUserToChirpyRed(
    data.userId
  );

  if (!user) {
    res.status(404).json({
      error: "User not found",
    });
    return;
  }

  res.status(204).send();
}
app.listen(config.api.port, () => {
  console.log(`Server is running on port ${config.api.port}`);
});