"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UploadPanel } from "./upload-panel";

/**
 * Header action: opens CSV upload in a modal instead of a standalone page.
 * Reuses the unchanged UploadPanel so the import flow is identical.
 */
export function AddDataButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        + Add data
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add transactions">
        <UploadPanel />
      </Modal>
    </>
  );
}
