import { describe, expect, it } from "vitest";
import {
  isProjectTemplateKey,
  PROJECT_TEMPLATE_KEYS,
  renderProjectTemplate,
  slugifyProjectName,
} from "./projectTemplates";

describe("Project templates", () => {
  it("slugifies project names into folder-safe slugs", () => {
    expect(slugifyProjectName("My Portfolio!")).toBe("my-portfolio");
    expect(slugifyProjectName("  Cool  --  App  ")).toBe("cool-app");
    expect(slugifyProjectName("")).toBe("my-project");
    expect(slugifyProjectName("БЛОГ")).toBe("my-project");
  });

  it("recognizes only the supported template keys", () => {
    expect(PROJECT_TEMPLATE_KEYS).toEqual(["static", "react", "next"]);
    expect(isProjectTemplateKey("react")).toBe(true);
    expect(isProjectTemplateKey("svelte")).toBe(false);
    expect(isProjectTemplateKey(42)).toBe(false);
  });

  it("static template: deployable as-is with an index.html at the root", () => {
    const project = renderProjectTemplate("static", "My Site");
    expect(project.deployRoot).toBe(".");
    const paths = project.files.map(file => file.path);
    expect(paths).toContain("index.html");
    expect(paths).toContain("styles.css");
    expect(paths).toContain("script.js");
    const index = project.files.find(file => file.path === "index.html")!;
    expect(index.content).toContain("<!doctype html>");
    expect(index.content).toContain("My Site");
    expect(index.content).toContain("styles.css");
  });

  it("react template: runs in the browser - React from a CDN, JSX compiled by Babel standalone", () => {
    const project = renderProjectTemplate("react", "My React App");
    expect(project.deployRoot).toBe(".");
    const paths = project.files.map(file => file.path);
    expect(paths).toEqual(expect.arrayContaining(["index.html", "src/main.jsx", "src/App.jsx", "src/styles.css"]));
    const index = project.files.find(file => file.path === "index.html")!;
    expect(index.content).toContain("https://unpkg.com/react@18");
    expect(index.content).toContain("https://unpkg.com/react-dom@18");
    expect(index.content).toContain("@babel/standalone");
    expect(index.content).toContain('type="text/babel"');
    // Babel standalone runs text/babel scripts in DOM order: App.jsx must be
    // loaded (and expose window.App) before main.jsx mounts it, or the page
    // renders nothing and the user sees a white screen.
    const appScript = index.content.indexOf('src="src/App.jsx"');
    const mainScript = index.content.indexOf('src="src/main.jsx"');
    expect(appScript).toBeGreaterThan(-1);
    expect(mainScript).toBeGreaterThan(appScript);
    const app = project.files.find(file => file.path === "src/App.jsx")!;
    expect(app.content).toContain("function App");
    expect(app.content).toContain("window.App = App");
    // No ESM in this no-bundler setup - Babel would compile the export to an
    // undefined `exports` and the global would never be defined.
    expect(app.content).not.toContain("export ");
    const main = project.files.find(file => file.path === "src/main.jsx")!;
    expect(main.content).toContain("window.App");
    expect(main.content).toContain("createRoot(");
  });

  it("next template: static-export Next.js scaffold whose out/ folder is what deploys", () => {
    const project = renderProjectTemplate("next", "My Next App");
    expect(project.deployRoot).toBe("out");
    expect(project.summary).toContain("out/");
    const paths = project.files.map(file => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "package.json",
        "next.config.mjs",
        "app/layout.jsx",
        "app/page.jsx",
        "app/globals.css",
        "README.md",
      ])
    );
    const config = project.files.find(file => file.path === "next.config.mjs")!;
    expect(config.content).toContain('output: "export"');
    const pkg = project.files.find(file => file.path === "package.json")!;
    expect(pkg.content).toContain('"build": "next build"');
    expect(pkg.content).toContain("my-next-app");
    // No index.html: a build in the agent VM produces it into out/.
    expect(paths).not.toContain("index.html");
  });
});
