/** Nova app router — Zo-inspired clean light theme system with orange accents across the whole application. */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import Chats from "./pages/Chats";
import Deployments from "./pages/Deployments";
import Files from "./pages/Files";
import More from "./pages/More";
import Profile from "./pages/Profile";
import Workspace from "./pages/Workspace";
import WorkspaceSettings from "./pages/WorkspaceSettings";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/sign-in"} component={SignIn} />
      <Route path={"/app"} component={Workspace} />
      <Route path={"/app/files"} component={Files} />
      <Route path={"/app/chats"} component={Chats} />
      <Route path={"/app/deployments"} component={Deployments} />
      <Route path={"/app/profile"} component={Profile} />
      <Route path={"/app/settings"} component={WorkspaceSettings} />
      <Route path={"/app/more"} component={More} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
