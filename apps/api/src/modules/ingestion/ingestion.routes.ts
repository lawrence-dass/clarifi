import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { AppError, badRequest } from "../../lib/app-error.js";
import { overrideCategory } from "../categorization/category-override.controller.js";
import { importStatement } from "./ingestion.controller.js";

/**
 * Transaction ingestion routes, mounted at /transactions. CSV upload is
 * multipart; multer keeps the file in memory (no disk), capped at 5 MB and
 * restricted to CSV content.
 */
export const transactionsRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isCsv =
      /csv/i.test(file.mimetype) ||
      file.mimetype === "application/vnd.ms-excel" || // some browsers tag .csv this way
      file.originalname.toLowerCase().endsWith(".csv");
    if (isCsv) cb(null, true);
    else cb(badRequest("INVALID_FILE_TYPE", "Only CSV files are accepted"));
  },
});

/** Run multer, translating its size-limit error to a 413 through the error contract. */
function uploadCsv(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("FILE_TOO_LARGE", 413, "CSV exceeds the 5MB limit"));
    }
    next(err ?? undefined);
  });
}

transactionsRouter.post("/import", requireAuth, uploadCsv, importStatement);
transactionsRouter.patch("/:transactionId/category", requireAuth, overrideCategory);
