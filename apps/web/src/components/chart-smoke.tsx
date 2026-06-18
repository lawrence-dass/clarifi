"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format-money";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const data = [
  { month: "Apr", cents: 12500 },
  { month: "May", cents: 9600 },
  { month: "Jun", cents: 14200 },
];

export function ChartSmoke() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chart foundation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatMoney(value, "CAD")}
                width={72}
              />
              <Bar dataKey="cents" fill="#0f766e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
