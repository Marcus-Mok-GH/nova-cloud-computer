/** Routes where the public Q&A assistant is available. */
export function isSupportBotRoute(location: string): boolean {
  const normalized = location.replace(/\/+$/, "") || "/";
  return (
    normalized === "/" || normalized === "/docs" || normalized === "/docs/api"
  );
}
