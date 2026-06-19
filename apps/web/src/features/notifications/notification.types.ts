export interface NotificationAnomaly {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  explanation: string | null;
  dismissed: boolean;
  createdAt: string;
  transaction: {
    id: string;
    amountCents: number;
    merchantName: string | null;
    category: string | null;
    date: string;
    currency: string;
  };
}

export interface AnomaliesResult {
  anomalies: NotificationAnomaly[];
  nextCursor: string | null;
}
