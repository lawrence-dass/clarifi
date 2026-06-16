import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BankFormat } from "./bank-profiles.js";
import { importCsv } from "./ingestion.service.js";
import { badRequest, unauthorized } from "../../lib/app-error.js";

const ImportBody = z.object({
  bankFormat: BankFormat,
  institution: z.string().trim().min(1).max(100),
});

/**
 * POST /transactions/import — multipart CSV upload (field `file`) + bankFormat +
 * institution. requireAuth has set req.userId; multer has parsed the file into
 * req.file.buffer. Returns the import summary (200).
 */
export async function importStatement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw unauthorized("UNAUTHENTICATED", "Authentication required");
    if (!req.file) throw badRequest("NO_FILE", "A CSV file is required (field 'file')");

    const { bankFormat, institution } = ImportBody.parse(req.body);
    const csv = req.file.buffer.toString("utf8");

    const result = await importCsv({ userId: req.userId, bankFormat, institution, csv });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
