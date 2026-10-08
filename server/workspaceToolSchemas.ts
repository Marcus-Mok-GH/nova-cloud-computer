import type { GatewayToolDefinition } from "./aiGateway";
import { GITHUB_OPERATIONS } from "./composio";

/**
 * The tool schemas advertised to the model on every workspace-agent run.
 * Pure data: keeping it out of the agent module makes a prompt or schema
 * edit a single-file read instead of a scroll through the run loop.
 */
export const WORKSPACE_TOOLS: GatewayToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "end_turn",
      description:
        "End your turn and deliver the final reply. This is the ONLY way your turn ends: writing text without calling a tool does NOT finish the run. When everything the user asked for is complete, call end_turn with your complete final reply to the user in the 'reply' argument - the reply must disclose any step that failed during the run and was not recovered, with its actual error text. Mid-run notes to the user go through send_progress_update instead, and plain text answers keep the run going.",
      parameters: {
        type: "object",
        properties: {
          reply: {
            type: "string",
            description: "Your complete final reply to the user.",
          },
        },
        required: ["reply"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_purchase",
      description:
        "Request a purchase from your agent wallet (personal agents only). The credits are NOT spent by this call: it records a request that only the user can confirm, in Nova's Agents page. Use it for anything that costs wallet credits; an amount over the remaining budget is rejected immediately. After calling it, tell the user the purchase is waiting for their approval, then end your turn.",
      parameters: {
        type: "object",
        properties: {
          item: {
            type: "string",
            description: 'What is being bought, e.g. "domain name for the launch site".',
          },
          amount_credits: {
            type: "integer",
            description: "Cost in wallet credits.",
          },
          note: {
            type: "string",
            description: "Optional context for the user reviewing the request.",
          },
        },
        required: ["item", "amount_credits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_agent_email",
      description:
        "Send an email from your own address (personal agents only). Recipients are a teammate's address, any email address, or 'user' for the workspace owner. The mail is NOT sent by this call: it records a request that only the user can confirm, in Nova's Agents page. After calling it, tell the user the email is waiting for their approval, then end your turn.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient: a teammate's email address, any email address, or 'user' for the workspace owner.",
          },
          subject: { type: "string", description: "Email subject." },
          body: { type: "string", description: "Email body text." },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_workspace",
      description:
        "List the current folders and files in the user's private workspace, with their ids and locations.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description:
        "Create a new file in the user's private workspace with the given name and content.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "File name including its extension, e.g. notes.txt",
          },
          content: {
            type: "string",
            description: "Full text content to store in the file.",
          },
          folder: {
            type: "string",
            description:
              "Optional existing folder name or id to place the file in. Omit for the workspace root.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full text content of an existing workspace file.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              'File name, id, or workspace path (e.g. "folder-name/index.html") to read.',
          },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace the entire content of an existing workspace file. Read the file first when unsure about its current content.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              'File name, id, or workspace path (e.g. "folder-name/index.html") to edit.',
          },
          content: {
            type: "string",
            description: "The new full content for the file.",
          },
        },
        required: ["file", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Rename an existing workspace file.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              'File name, id, or workspace path (e.g. "folder-name/index.html") to rename.',
          },
          new_name: {
            type: "string",
            description: "The new file name, including its extension.",
          },
        },
        required: ["file", "new_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_file",
      description: "Move an existing workspace file into a folder.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              'File name, id, or workspace path (e.g. "folder-name/index.html") to move.',
          },
          folder: {
            type: "string",
            description: "Target folder name or id.",
          },
        },
        required: ["file", "folder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file from the user's private workspace.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              'File name, id, or workspace path (e.g. "folder-name/index.html") to delete.',
          },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_folder",
      description: "Create a new folder in the user's private workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Folder name." },
          parent: {
            type: "string",
            description:
              "Optional existing parent folder name or id. Omit for the workspace root.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_folder",
      description: "Rename an existing workspace folder.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Folder name or id to rename.",
          },
          new_name: { type: "string", description: "The new folder name." },
        },
        required: ["folder", "new_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_folder",
      description: "Move an existing workspace folder into another folder.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder name or id to move." },
          parent: {
            type: "string",
            description: "Target parent folder name or id.",
          },
        },
        required: ["folder", "parent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_folder",
      description:
        "Delete a folder and everything inside it from the user's private workspace.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Folder name or id to delete.",
          },
        },
        required: ["folder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_telegram_message",
      description:
        "Send a text message to the user's linked Telegram chat. Requires Telegram to be connected.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text to send." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_file",
      description:
        "Present a workspace file to the user over Telegram so they can view or download it: images are shown inline for viewing, other files arrive as a downloadable document. Use it proactively whenever it helps - any time you create or meaningfully update a file worth showing, not only when the user explicitly asked for that file - since over Telegram they cannot browse the workspace themselves. Only available on Telegram requests. Requires Telegram to be connected.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "Name or id of the workspace file to present.",
          },
          caption: {
            type: "string",
            description: "Optional one-line note to show alongside the file.",
          },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_communication_style",
      description:
        "Save the user's preferred communication style so every future reply follows it, across all chats and sessions. Use it whenever the user states or changes how they want you to communicate - e.g. 'keep replies short', 'be structured with headings', 'more conversational', 'always reply in French'. Distill their words into a concise style description (one or two sentences). Also call it with an empty style to clear the preference.",
      parameters: {
        type: "object",
        properties: {
          style: {
            type: "string",
            description:
              "Concise description of how the user wants you to communicate, e.g. 'Short, direct replies. No filler.' - or an empty string to clear the saved style.",
          },
        },
        required: ["style"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_personalisation",
      description:
        "Save or update the user's personalisation profile and the structured preferences that tune how Nova works with them. Use it during a personalisation session, and whenever the user states a lasting preference about how you should work, communicate or collaborate. Only pass the fields you are changing - pass an empty string to clear a text field.",
      parameters: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "Turn personalisation mode on or off for this workspace.",
          },
          profile: {
            type: "string",
            description:
              "A concise profile of the user distilled from what they tell you - their role, goals, recurring work and what matters to them. A few sentences at most.",
          },
          tone: {
            type: "string",
            description:
              "Preferred tone, e.g. 'warm and encouraging' or 'direct and no-nonsense'.",
          },
          detail: {
            type: "string",
            enum: ["brief", "balanced", "detailed"],
            description: "How much detail the user prefers in your replies.",
          },
          proactiveness: {
            type: "string",
            enum: ["ask_first", "act_and_tell", "autonomous"],
            description:
              "How much Nova should do on its own before checking in: ask_first, act_and_tell, or autonomous.",
          },
          expertise: {
            type: "string",
            enum: ["new", "some", "expert"],
            description:
              "The user's familiarity with these tools, which sets how much you explain: new, some, or expert.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_progress_update",
      description:
        "Send the user a brief mid-task progress note over Telegram (opening ETA, revised ETA, interim status, or a blocker notice). Use this while working on a request; use send_telegram_message when sending a message is itself the task. Requires Telegram to be connected.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              'The progress note, e.g. "I\'ll get this done within about 1-2 minutes."',
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_website",
      description:
        "Publish a chosen directory of the workspace as a live website on Netlify's free static hosting - always on, with SSL. The directory's contents become the site (its folder structure is kept relative to it) and its index.html is the entry page. You MUST deliberately choose which directory to deploy: the project or build-output folder that holds the site, not unrelated workspace files - pass '/' only when the site genuinely lives at the workspace root. You must also deliberately choose the deployment target: pass an existing deployment ID (e.g. 'd-01') to publish to that deployment - its URL never changes while the content updates - or omit it to create a brand-new deployment with its own ID and URL. Every deploy must also carry a short description of the deployment's purpose. NEVER overwrite one deployment's content by deploying a different project to it: iterate a site by its ID, and give a separate project its own new deployment. Anything static hosting serves publishes as-is: plain HTML/CSS/JS sites, React apps, statically exported Next.js projects, single-page apps, portfolios, and so on. A deploy can take up to a minute.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "Workspace-relative directory to publish, e.g. 'my-react-app' or 'my-next-app/out'. Pass '/' for the workspace root. Its index.html becomes the entry page.",
          },
          deployment: {
            type: "string",
            description:
              "The ID of the existing deployment to publish to, e.g. 'd-01' (find the workspace's deployments with their IDs in the system prompt). Its URL stays the same. Omit to create a new deployment - never guess an ID.",
          },
          description: {
            type: "string",
            description:
              "A short description of what this deployment is, e.g. 'portfolio site' or 'bakery landing page'. Required on EVERY deploy_website call - it names the deployment's purpose and is kept in the workspace's deployment registry across chats. On a redeploy, pass the deployment's current description (or a corrected one when the purpose changed).",
          },
        },
        required: ["directory", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_website",
      description:
        "Delete one of the user's website deployments from Netlify - the URL goes offline immediately and this is irreversible (their workspace files are NOT touched). Use this whenever the user asks to delete, remove, unpublish, take down, or tear down their site, deployment, or live website. The deployment is chosen by its ID (e.g. 'd-01' - find the workspace's deployments with their IDs in the system prompt); when several deployments exist or the request is vague, show the user the deployment list and ask which one they mean first. all: true deletes every deployment, but it is gated: the first all: true call only returns the full target list and deletes nothing; execute the sweep by re-calling with confirm_all set to exactly the listed deployment IDs, and only once the user has explicitly confirmed deleting every deployment on it. Never call this unless the user clearly asked for a deletion.",
      parameters: {
        type: "object",
        properties: {
          deployment: {
            type: "string",
            description:
              "The ID of the deployment to delete, e.g. 'd-01'. Never guess an ID - it comes from the deployment list in the system prompt.",
          },
          all: {
            type: "boolean",
            description:
              "true targets every deployment this workspace has ever made, not one specific one. Default false.",
          },
          confirm_all: {
            type: "array",
            items: { type: "string" },
            description:
              "The confirmation for an all-deployments sweep: the deployment IDs exactly as the gated all: true response listed them. Anything else (empty, stale, partial, extra) leaves the sweep unexecuted.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project_template",
      description:
        "Scaffold a clean project in the workspace from a template: 'static' (plain HTML/CSS/JS site), 'react' (React single-page app that runs in the browser - no build step), or 'next' (Next.js App Router configured for static export; needs a VM build before deploying). The template lands in its own folder so deployments stay clean - deploy_website then publishes that folder (for 'next', its out/ build output). Use this when the user wants a new site or app started from scratch, or wants their project organized properly before going live. If the user did not ask for a specific stack, do not ask them - pick the best fit yourself and say which stack you chose.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Project name - becomes the folder name (e.g. 'My Portfolio' -> 'my-portfolio').",
          },
          template: {
            type: "string",
            enum: ["static", "react", "next"],
            description:
              "The project type to scaffold. If the user did not specify a stack, choose the best fit for their request: 'react' for web apps and interactive sites (the default), 'static' only for a genuinely simple single page or when the user explicitly wants plain HTML, 'next' when they explicitly want Next.js. Omitting it scaffolds 'react'.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github",
      description:
        "Use GitHub through Nova's stable connector interface. Do not search for raw GitHub actions, GitHub App installations, or event endpoints. For every repository operation, pass repo as owner/name (for example 'octocat/Hello-World'). Use number for an issue or pull request number. Search repositories is limited to the connected account by default; use scope:'public' only when the user explicitly asks for public repositories outside their account. When the user says 'my repo' or asks to clone a repository, never accept an arbitrary public match: verify the returned owner and repository before proceeding, and ask for clarification when multiple matches remain. Only include fields relevant to the selected operation. Requires GitHub to be connected in Settings.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: GITHUB_OPERATIONS,
            description:
              "search_repositories finds repositories (omit repo); get_repository reads repo metadata; read_file reads a file; list_pull_requests lists PRs; get_pull_request reads one PR; get_issue reads one issue; list_issue_comments reads an issue/PR discussion; create_issue opens an issue; comment_on_issue comments on an issue/PR; create_pull_request opens a PR from an existing branch; write_file creates or updates one file.",
          },
          repo: {
            type: "string",
            description:
              "Repository in owner/name format, for example 'Marcus-Mok-GH/nova-cloud-computer'. Omit only for search_repositories.",
          },
          query: {
            type: "string",
            description:
              "Repository search text. By default, results are limited to repositories accessible to the connected account.",
          },
          owner: {
            type: "string",
            description: "Optional owner filter for search_repositories.",
          },
          scope: {
            type: "string",
            enum: ["mine", "public"],
            description:
              "Search scope. Defaults to mine; use public only when the user explicitly requests repositories outside the connected account.",
          },
          path: {
            type: "string",
            description:
              "File path relative to the repository root for read_file or write_file.",
          },
          ref: {
            type: "string",
            description:
              "Optional branch, tag, or commit to read from with read_file.",
          },
          number: {
            type: "integer",
            description:
              "Issue or pull request number for get_issue, get_pull_request, list_issue_comments, or comment_on_issue.",
          },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description:
              "Pull request state for list_pull_requests. Defaults to open.",
          },
          per_page: {
            type: "integer",
            description: "Optional page size, maximum 100.",
          },
          title: {
            type: "string",
            description:
              "Issue or pull request title for create_issue or create_pull_request.",
          },
          body: {
            type: "string",
            description:
              "Markdown body for create_issue, comment_on_issue, or create_pull_request.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional labels for create_issue.",
          },
          head: {
            type: "string",
            description: "Existing source branch for create_pull_request.",
          },
          base: {
            type: "string",
            description: "Existing target branch for create_pull_request.",
          },
          draft: {
            type: "boolean",
            description:
              "Whether create_pull_request should create a draft PR.",
          },
          content: {
            type: "string",
            description: "Plain-text file contents for write_file.",
          },
          message: {
            type: "string",
            description: "Commit message for write_file.",
          },
          branch: {
            type: "string",
            description:
              "Optional branch for write_file; defaults to the repository's default branch.",
          },
          sha: {
            type: "string",
            description: "Optional current file SHA for write_file updates.",
          },
        },
        required: ["operation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_connector_tools",
      description:
        "Search the Gmail connector catalog and return exact Gmail action slugs and parameter schemas. Use only for Gmail; GitHub has its own github tool.",
      parameters: {
        type: "object",
        properties: {
          connector: {
            type: "string",
            enum: ["gmail"],
            description: "Must be gmail.",
          },
          search: {
            type: "string",
            description: "Optional words to filter Gmail actions.",
          },
          limit: {
            type: "number",
            description: "Max actions to return, 1-50 (default 25).",
          },
        },
        required: ["connector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_connector_tool",
      description:
        "Execute a Gmail action on the user's behalf through the connector. The action slug must come from list_connector_tools with exactly the parameters it declares. GitHub uses the dedicated github tool instead.",
      parameters: {
        type: "object",
        properties: {
          connector: {
            type: "string",
            enum: ["gmail"],
            description: "Must be gmail.",
          },
          action: {
            type: "string",
            description: "The exact Gmail action slug.",
          },
          params: {
            type: "object",
            description:
              "The action's parameters as a JSON object, exactly as listed by list_connector_tools.",
          },
        },
        required: ["connector", "action", "params"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "solve_equation",
      description:
        "Solve a math equation exactly and return the numeric answer. Use this whenever the user asks to calculate, add, subtract, multiply, divide, convert, total, or any numbers appear in the answer - ALL arithmetic goes through this tool, never mental math. Express the problem as a single mathematical expression (e.g. '20 - (5*2 + 2*(2/3))' or 'sqrt(196) * 3.5'); word problems must be translated into an expression first.",
      parameters: {
        type: "object",
        properties: {
          equation: {
            type: "string",
            description:
              "A single mathematical expression to evaluate, e.g. '20 - 11.33' or 'sqrt(196) * 3.5'.",
          },
        },
        required: ["equation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "base44",
      description:
        "Encode UTF-8 text to Base44 or decode a Base44 string back to UTF-8 text. Uses the QR-compatible alphabet 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./: with two bytes encoded as three characters and one byte as two characters. Use this whenever the user asks for Base44 conversion.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["encode", "decode"],
            description:
              "Whether to encode text as Base44 or decode Base44 back to UTF-8 text.",
          },
          value: {
            type: "string",
            description: "UTF-8 text to encode, or a Base44 string to decode.",
          },
        },
        required: ["operation", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_web",
      description:
        "Delegate deep research to Exa AI's deep research models. The chosen model fans out live web searches, reads and cross-checks the sources, and returns a research report with inline citations and a numbered source list. Use it for anything current or factual you do not know for certain. You MUST choose the difficulty yourself on every single call, estimating how deep the research needs to be before calling - never omit it, never default lazily. Say nothing about the choice unless asked.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic or question to research.",
          },
          difficulty: {
            type: "string",
            enum: ["deep-lite", "deep", "deep-reasoning"],
            description:
              "The research depth you estimate this question needs - decide deliberately every call. deep-lite (~10 seconds): a single factual lookup with one clear answer - current versions, prices, release dates, simple facts, definitions. deep: questions needing multiple searches or several sources synthesized - comparisons, how things work, market overviews, current events with context, anything with 2-3 facets. deep-reasoning: the deepest level - complex investigations with many facets, conflicting or hard-to-find evidence, technical analysis, forecasts, or multi-hop questions where the answer depends on other answers. Calibrate: most questions land on deep; only unambiguous single-fact lookups justify deep-lite; escalate to deep-reasoning when evidence conflicts or the question has 4+ facets.",
          },
          instructions: {
            type: "string",
            description:
              "Optional focus, constraints or specific questions the research should answer.",
          },
        },
        required: ["topic", "difficulty"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "thinker",
      description:
        "Delegate deep, open-ended reasoning to Nova's thinker sub-agent - a frontier reasoning model that thinks a hard problem through and returns a long, detailed analysis of its findings. Use it when a request needs sustained reasoning rather than lookup or computation: weighing a design or strategy decision, planning a multi-step approach, analyzing a body of material for what it implies, reviewing your own reasoning before committing to it, or untangling a subtle trade-off, risk, or failure mode. Describe the question completely and include all relevant context - the thinker cannot see the conversation or the workspace on its own. It returns its analysis only; it does not call tools or act. Do not send it simple lookups, arithmetic, or code (use research_web, solve_equation, or editor for those).",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The question or problem to think through, described completely, including what a good answer must resolve.",
          },
          context: {
            type: "string",
            description:
              "Optional supporting material: relevant facts, code, data, constraints, prior reasoning, or conversation state the question depends on.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "accept_own_coding",
      description:
        "Records that the user explicitly accepted Nova writing the code itself while the coding specialist is down. Call this ONLY when the editor sub-agent failed in an EARLIER conversation turn AND the user's latest message clearly said yes to Nova's own attempt. It refuses inside the same run as the failure (the user must answer first), and while it has not succeeded, create_file and edit_file are blocked for non-trivial code.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "editor",
      description:
        "Delegate file editing and creation to Nova's editor sub-agent - a frontier coding model served by Nova. This is the default for ALL substantial file work: creating a whole app or site, writing whole files, functions, components, scripts, algorithms, refactoring, tricky bug fixes, or making big changes in bulk across many files. Describe the task completely (goal, language, constraints) and include the relevant existing code or the exact error in context. The specialist works autonomously: it reads, writes and verifies the workspace files itself, and the files it writes are synced into the workspace before the result returns - so read the changed files it reports back, verify the work, and fix anything it left broken. Only when the result is bare code (no sandbox available) do you place it into the workspace with your file tools yourself. Never write non-trivial code directly with create_file or edit_file instead of delegating. Only skip it for tiny snippets you can write instantly (a one-line fix, a few lines of markup), shell commands, or math - use your own tools for those.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "The file editing or creation task, described completely: what to build, edit or fix, in which language or framework, and any constraints.",
          },
          context: {
            type: "string",
            description:
              "Optional supporting material: existing code to extend or fix, the exact error output, file or API layouts the code must fit.",
          },
          language: {
            type: "string",
            description:
              "Optional explicit target language or framework, e.g. 'Python', 'React SPA', 'plain HTML/CSS/JS'.",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_bash",
      description:
        "Run a bash command in the live workspace sandbox and get its exit code, stdout and stderr. The sandbox is awake for the whole run and its working directory is your workspace: the same files and folders the file tools operate on, plus anything bash creates (synced to durable storage automatically). Use it for quick shell work - ls, grep, wc, head, chmod, git, tar - and prefer it over run_vm_task for anything that does not need Python. No sudo; 120-second timeout.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The bash command to run, e.g. 'wc -l notes.txt' or 'grep -c TODO *.md'.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browse",
      description:
        "Drive a real headless Chrome browser in the workspace sandbox through the agent-browser CLI - open pages, read rendered text, click, fill forms, scroll, screenshot pages into workspace files, and take the accessibility snapshot with element refs. Give the agent-browser command WITHOUT the binary name, e.g. 'open https://example.com', 'snapshot', 'read', 'click @e2', 'fill @e3 \"test@example.com\"', 'screenshot page.png'. If the browser is not installed yet, the call starts a one-time background install and asks you to retry in about 2-3 minutes; once installed, calls are fast. Prefer research_web for deep open-ended research; use browse when you need to interact with a specific page.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The agent-browser command to run, without the binary, e.g. 'open https://example.com' or 'snapshot'.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_vm_task",
      description:
        "Run a Python 3 script in an isolated E2B sandbox VM with internet access and a 240-second limit. Use this whenever real computation is needed: the user asks to calculate or process data beyond simple arithmetic, run or test code, scrape or fetch from the web, or analyze, count, filter, sort, convert or extract content. This is the tool for real execution: installing and using packages (pip install, e.g. requests), scraping or browsing with HTTP libraries, processing data, or running shell commands via subprocess.run(['cmd','arg'], capture_output=True, text=True). It is NOT for workspace file management - use create_file / edit_file / read_file and the other dedicated tools for that; they are faster, safer, and sync instantly. Only reach for the VM when code actually needs to run. Always write complete Python code in `code` - `task` is just a short label for the run. The script sees the workspace's files under /home/user/workspace/input (each mounted with an id prefix, e.g. input/104-calc.py - the exact mounted paths are returned with every run result, so do not guess them) and should print() anything you want to report; workspace files changed or created during the run are synced back automatically.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Short label for the run (max ~80 chars).",
          },
          code: {
            type: "string",
            description:
              "The complete Python 3 script to execute in the sandbox VM. Use print() to output results.",
          },
        },
        required: ["task", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memories",
      description:
        "Search the user's conversation memories - records of past conversations and saved notes, each with a title, a summary, and the full transcript. Use this whenever the user references earlier work, a past decision, a previous conversation, or anything you cannot see in the current chat. With no query, returns the most recent memories.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional keyword or phrase to search titles, summaries, tags, and transcripts.",
          },
          limit: {
            type: "number",
            description: "Max results (1-25, default 8).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_memory",
      description:
        "Read one full memory record (the complete transcript or note) by its id, as listed by search_memories or the recent memories in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "The memory id to read." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Save a durable memory: a fact, decision, preference, or the running state of a long multi-step task. Long context is not reliable storage - do not carry multi-step state in the conversation alone; save it here and read it back with read_memory before resuming. Conversation histories are captured automatically - use this for standalone notes, not for copying the current chat.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the memory." },
          summary: {
            type: "string",
            description:
              "One or two sentences capturing what this memory holds.",
          },
          content: {
            type: "string",
            description: "The full text to remember.",
          },
          tags: {
            type: "string",
            description: "Optional comma-separated keywords for later search.",
          },
        },
        required: ["title", "summary", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description:
        "Delete one memory record by id - for example when the user asks to forget something or a saved note turned out wrong. This cannot be undone.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "The memory id to delete." },
        },
        required: ["id"],
      },
    },
  },
];
