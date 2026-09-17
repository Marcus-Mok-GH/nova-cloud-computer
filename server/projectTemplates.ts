/** Project templates Nova can scaffold into the workspace.
 *
 * Each template renders a self-contained project folder the agent (or the
 * user) can build on, and every template is deployable through
 * deploy_website on Netlify's free static hosting. `deployRoot` tells the
 * agent which subdirectory contains the publishable site - for static and
 * react that is the project folder itself (they run straight in the browser),
 * while a next.js project needs `next build` in the agent VM first and its
 * static `out/` folder is what gets published. */

export type ProjectTemplateKey = "static" | "react" | "next";

export type TemplateFile = {
  /** Path relative to the project folder, e.g. "src/App.jsx". */
  path: string;
  content: string;
  mimeType: string;
};

export type RenderedProjectTemplate = {
  /** The project's files, ready to create under the project folder. */
  files: TemplateFile[];
  /** The directory to publish with deploy_website, relative to the project folder. */
  deployRoot: string;
  /** Short human explanation of what this template gives and how it deploys. */
  summary: string;
};

export const PROJECT_TEMPLATE_KEYS: ProjectTemplateKey[] = ["static", "react", "next"];

export function isProjectTemplateKey(value: unknown): value is ProjectTemplateKey {
  return typeof value === "string" && (PROJECT_TEMPLATE_KEYS as string[]).includes(value);
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "my-project";
}

const HTML_MIME = "text/html";
const CSS_MIME = "text/css";
const JS_MIME = "text/javascript";
const JSON_MIME = "application/json";

function staticTemplate(name: string): RenderedProjectTemplate {
  const title = name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "My Site";
  return {
    deployRoot: ".",
    summary:
      "A plain HTML/CSS/JS site. It deploys as-is with deploy_website (choose this project folder).",
    files: [
      {
        path: "index.html",
        mimeType: HTML_MIME,
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="card">
      <h1>${title}</h1>
      <p id="greeting">Edit this page and ask Nova to deploy it.</p>
      <button id="ping">Click me</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`,
      },
      {
        path: "styles.css",
        mimeType: CSS_MIME,
        content: `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, sans-serif;
  background: #f6f7fb;
  color: #191b22;
}
.card {
  background: #fff;
  padding: 2.5rem 3rem;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(15, 15, 25, 0.08);
  text-align: center;
  max-width: 26rem;
}
h1 { margin: 0 0 0.75rem; font-size: 1.75rem; }
p { color: #5b5f6b; line-height: 1.6; margin: 0 0 1.5rem; }
button {
  border: 0;
  background: #4f46e5;
  color: #fff;
  font-weight: 600;
  padding: 0.65rem 1.4rem;
  border-radius: 10px;
  cursor: pointer;
}
button:hover { background: #4338ca; }
`,
      },
      {
        path: "script.js",
        mimeType: JS_MIME,
        content: `let clicks = 0;
const button = document.getElementById("ping");
const greeting = document.getElementById("greeting");
button.addEventListener("click", () => {
  clicks += 1;
  greeting.textContent = clicks === 1 ? "Nice - it works!" : \`Clicked \${clicks} times.\`;
});
`,
      },
    ],
  };
}

function reactTemplate(name: string): RenderedProjectTemplate {
  const title = name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "My React App";
  return {
    deployRoot: ".",
    summary:
      "A React single-page app that runs straight in the browser (React from a CDN, JSX compiled by Babel standalone - no build step needed). It deploys as-is with deploy_website (choose this project folder).",
    files: [
      {
        path: "index.html",
        mimeType: HTML_MIME,
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="src/styles.css" />
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" src="src/main.jsx"></script>
  </body>
</html>
`,
      },
      {
        path: "src/main.jsx",
        mimeType: JS_MIME,
        content: `const { createRoot } = ReactDOM;
createRoot(document.getElementById("root")).render(<App />);
`,
      },
      {
        path: "src/App.jsx",
        mimeType: JS_MIME,
        content: `const { useState } = React;

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="card">
      <h1>${title}</h1>
      <p>Edit src/App.jsx, then ask Nova to deploy.</p>
      <button onClick={() => setCount(count + 1)}>
        Clicked {count} {count === 1 ? "time" : "times"}
      </button>
    </main>
  );
}
`,
      },
      {
        path: "src/styles.css",
        mimeType: CSS_MIME,
        content: `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, sans-serif;
  background: #f6f7fb;
  color: #191b22;
}
.card {
  background: #fff;
  padding: 2.5rem 3rem;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(15, 15, 25, 0.08);
  text-align: center;
  max-width: 26rem;
}
h1 { margin: 0 0 0.75rem; font-size: 1.75rem; }
p { color: #5b5f6b; line-height: 1.6; margin: 0 0 1.5rem; }
button {
  border: 0;
  background: #4f46e5;
  color: #fff;
  font-weight: 600;
  padding: 0.65rem 1.4rem;
  border-radius: 10px;
  cursor: pointer;
}
button:hover { background: #4338ca; }
`,
      },
    ],
  };
}

function nextTemplate(name: string): RenderedProjectTemplate {
  const slug = slugifyProjectName(name);
  const title = name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "My Next App";
  return {
    deployRoot: "out",
    summary:
      "A Next.js App Router project configured for static export (output: \"export\"). It needs a build before deploying: run `npm install && npm run build` inside the project in the agent VM, copy the generated out/ folder into the workspace, then deploy_website with the out folder as the directory.",
    files: [
      {
        path: "package.json",
        mimeType: JSON_MIME,
        content: `{
  "name": "${slug}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
`,
      },
      {
        path: "next.config.mjs",
        mimeType: JS_MIME,
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
};

export default nextConfig;
`,
      },
      {
        path: "jsconfig.json",
        mimeType: JSON_MIME,
        content: `{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
`,
      },
      {
        path: "app/layout.jsx",
        mimeType: JS_MIME,
        content: `import "./globals.css";

export const metadata = {
  title: "${title}",
  description: "Built with Nova and Next.js.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      {
        path: "app/page.jsx",
        mimeType: JS_MIME,
        content: `export default function Home() {
  return (
    <main className="card">
      <h1>${title}</h1>
      <p>Edit app/page.jsx, rebuild, then ask Nova to deploy.</p>
    </main>
  );
}
`,
      },
      {
        path: "app/globals.css",
        mimeType: CSS_MIME,
        content: `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, sans-serif;
  background: #f6f7fb;
  color: #191b22;
}
.card {
  background: #fff;
  padding: 2.5rem 3rem;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(15, 15, 25, 0.08);
  text-align: center;
  max-width: 26rem;
}
h1 { margin: 0 0 0.75rem; font-size: 1.75rem; }
p { color: #5b5f6b; line-height: 1.6; margin: 0; }
`,
      },
      {
        path: "README.md",
        mimeType: "text/markdown",
        content: `# ${slug}

Next.js App Router project, statically exportable.

Build and deploy with Nova:
1. \`npm install\` then \`npm run build\` (Nova can run this in its agent VM).
2. The build writes static files to \`out/\`.
3. Nova publishes \`out/\` with deploy_website.

To run locally: \`npm install && npm run dev\`.
`,
      },
    ],
  };
}

/** Renders a project template for the given project name. */
export function renderProjectTemplate(
  template: ProjectTemplateKey,
  name: string
): RenderedProjectTemplate {
  switch (template) {
    case "react":
      return reactTemplate(name);
    case "next":
      return nextTemplate(name);
    case "static":
    default:
      return staticTemplate(name);
  }
}
