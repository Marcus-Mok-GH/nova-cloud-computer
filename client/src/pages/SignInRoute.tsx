/**
 * `/sign-in` during the pre-launch window.
 *
 * The gate lives here rather than inside `SignIn` so the real sign-in page keeps
 * its single responsibility, and so this component - not the auth form - decides
 * what the public URL renders. `?waitlist=0` gives the owner a way back in
 * without shipping anything on launch day.
 */
import React from "react";
import { isWaitlistActive, isWaitlistBypassed } from "@shared/waitlist";
import SignIn from "./SignIn";
import Waitlist from "./Waitlist";

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export default function SignInRoute() {
  if (isWaitlistActive() && !isWaitlistBypassed(currentSearch())) return <Waitlist />;
  return <SignIn />;
}