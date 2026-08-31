"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidDateString } from "@/lib/date";

export function GoToDate() {
  const [date, setDate] = useState("");
  const router = useRouter();

  function handleGo() {
    if (isValidDateString(date)) {
      router.push(`/day/${date}`);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="flex-1"
        onKeyDown={(e) => e.key === "Enter" && handleGo()}
      />
      <Button onClick={handleGo} disabled={!isValidDateString(date)} variant="outline">
        Go
      </Button>
    </div>
  );
}
