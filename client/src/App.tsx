/** Nova app router - Zo-inspired clean light theme system with orange accents across the whole application. */
import { Analytics } from "@vercel/analytics/react";
import { shouldShowWaitlist } from "@shared/waitlist";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import SupportBot from "./components/SupportBot";
import { isSupportBotRoute } from "./lib/supportBot";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import SignInRoute from "./pages/SignInRoute";
import Chats from "./pages/Chats";
import Agents from "./pages/Agents";
import Skills from "./pages/Skills";
import Deployments from "./pages/Deployments";
import Terminal from "./pages/Terminal";
import Files from "./pages/Files";
import More from "./pages/More";
import Profile from "./pages/Profile";
import Workspace from "./pages/Workspace";
import WorkspaceSettings from "./pages/WorkspaceSettings";
import Billing from "./pages/Billing";
import Status from "./pages/Status";
import Admin from "./pages/Admin";
import ApiDocs from "./pages/ApiDocs";
import Checkout from "./pages/Checkout";
import Waitlist from "./pages/Waitlist";

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function Router() {
  const [location] = useLocation();
  // While Nova's storage limits are being reset, every route that needs the
  // database shows the waitlist instead of failing. The landing page and the
  // API docs are static and stay up - the landing page is the way in.
  if (shouldShowWaitlist(location, currentSearch())) return <Waitlist />;
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/sign-in"} component={SignInRoute} />
      <Route path={"/app"} component={Workspace} />
      <Route path={"/app/files"} component={Files} />
      <Route path={"/app/chats"} component={Chats} />
      <Route path={"/app/agents"} component={Agents} />
      <Route path={"/app/skills"} component={Skills} />
      <Route path={"/app/deployments"} component={Deployments} />
      <Route path={"/app/terminal"} component={Terminal} />
      <Route path={"/app/profile"} component={Profile} />
      <Route path={"/app/settings"} component={WorkspaceSettings} />
      <Route path={"/app/billing"} component={Billing} />
      <Route path={"/app/status"} component={Status} />
      <Route path={"/app/more"} component={More} />
      <Route path={"/app/admin"} component={Admin} />
      <Route path={"/app/admin/notifications"} component={Admin} />
      <Route path={"/checkout"} component={Checkout} />
      <Route path={"/app/checkout"} component={Checkout} />
      <Route path={"/docs"} component={ApiDocs} />
      <Route path={"/docs/api"} component={ApiDocs} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** The public Q&A widget is only mounted on the landing and docs pages. */
function PublicSupportBot() {
  const [location] = useLocation();
  return isSupportBotRoute(location) ? <SupportBot /> : null;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <LanguageProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
            <PublicSupportBot />
            <Analytics />
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
