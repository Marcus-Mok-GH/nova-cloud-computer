/** Nova app router - Zo-inspired clean light theme system with orange accents across the whole application. */
import { Analytics } from "@vercel/analytics/react";
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
import SignIn from "./pages/SignIn";
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
import Status from "./pages/Status";
import Admin from "./pages/Admin";
import ApiDocs from "./pages/ApiDocs";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/sign-in"} component={SignIn} />
      <Route path={"/app"} component={Workspace} />
      <Route path={"/app/files"} component={Files} />
      <Route path={"/app/chats"} component={Chats} />
      <Route path={"/app/agents"} component={Agents} />
      <Route path={"/app/skills"} component={Skills} />
      <Route path={"/app/deployments"} component={Deployments} />
      <Route path={"/app/terminal"} component={Terminal} />
      <Route path={"/app/profile"} component={Profile} />
      <Route path={"/app/settings"} component={WorkspaceSettings} />
      <Route path={"/app/status"} component={Status} />
      <Route path={"/app/more"} component={More} />
      <Route path={"/app/admin"} component={Admin} />
      <Route path={"/app/admin/notifications"} component={Admin} />
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
