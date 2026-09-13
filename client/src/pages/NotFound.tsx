import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import NovaMark from "@/components/NovaMark";
import { Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-card dark:bg-background">
      <Card className="mx-4 w-full max-w-lg border-border bg-card shadow-[0_8px_30px_rgba(10,10,10,0.06)] dark:border-white/10 dark:bg-card">
        <CardContent className="pb-8 pt-10 text-center">
          <NovaMark size={44} className="mx-auto" />

          <h1 className="mt-6 text-4xl font-extrabold tracking-tight">404</h1>

          <h2 className="mt-2 text-xl font-bold text-foreground/80 dark:text-foreground">
            Page Not Found
          </h2>

          <p className="mt-3 text-muted-foreground dark:text-muted-foreground">
            Sorry, the page you are looking for doesn't exist.
            <br />
            It may have been moved or deleted.
          </p>

          <div
            id="not-found-button-group"
            className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"
          >
            <Button
              onClick={handleGoHome}
              className="rounded-full bg-[oklch(0.72_0.015_250)] px-6 hover:bg-primary/90"
            >
              <Home className="size-4" />
              Go Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
