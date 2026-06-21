import { redirect } from "next/navigation";

// Upload is now a header action (the "+ Add data" modal), not a destination.
// Keep the route alive for old deep-links by redirecting to the dashboard.
export default function UploadPage() {
  redirect("/dashboard");
}
