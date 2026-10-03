"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Where to go after signing in: the page the proxy bounced you from, or
// the dashboard. "/" would be the public landing page (#510), not where an
// owner signing in means to go. Only same-site paths are honoured — "//host"
// and "/\host" are protocol-relative URLs a crafted ?from= could use to
// redirect off-site.
function safeReturnPath(from: string | null): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) {
    return "/home";
  }
  return from === "/" ? "/home" : from;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!response.ok) {
      setError("Incorrect password");
      return;
    }

    router.replace(safeReturnPath(searchParams.get("from")));
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm md:max-w-md">
      <CardHeader>
        <CardTitle className="font-heading text-3xl italic">Data Diary</CardTitle>
        <CardDescription>Sign in to continue.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
