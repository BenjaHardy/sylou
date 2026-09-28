# Self-hosting Sylou

This guide walks through setting up your own Sylou instance from scratch, with the full manual sequence.
If you get stuck at any step, please [open an issue](https://github.com/BenjaHardy/sylou/issues).

---

## Before you start

### What you'll need

**Accounts:**
- A [Supabase](https://supabase.com) account (free tier works for personal and small-team use)
- An API key from at least one LLM provider (among the usable APIs, both Anthropic/Claude and Mistral provide accurate and reliable FLOW analysis results and either of them is therefore recommended as a default option for the FLOW analysis):
  - [Anthropic](https://console.anthropic.com) for Claude models
  - [Mistral](https://console.mistral.ai) for Mistral models
  - Make sure to check and review the confidentiality settings of the API and adjust as desired 
- Optionally, a [Brave Search](https://api.search.brave.com) API key if you want web search inside Sylou; note that Brave Search API's terms of services require to disable model training on data
- A frontend hosting account ([Vercel](https://vercel.com), [Cloudflare Pages](https://pages.cloudflare.com), or any static host)

**Tools installed locally:**
- [Git](https://git-scm.com) (Note: The Git installer's defaults are fine; if you don't know Vim, choose Notepad as Git's default editor when asked.)
- [Node.js](https://nodejs.org) v22.13 or later (and npm, which comes with it)

**Time and budget:**
- 30–60 minutes for first-time setup
- LLM API usage costs depend on how much you use Sylou. Light personal use is typically a few dollars per month; multi-user deployments scale with usage. Set per-user budgets if needed; for more details, see [Operating your instance](#operating-your-instance).

### A note on self-hosting Sylou

By self-hosting, you become the operator of your instance and are responsible for your instance.
Meaning, in practice:

- **Your users' data live on your Supabase project.** Nothing flows to the Sylou project. Data handling, retention, backups, and security are yours to define.
- **Need to write your own documents, such as Terms of Use and Privacy Policy, and to comply with relevant regulation, such as GDPR**, if you operate Sylou for anyone other than yourself.
- **Database-level data access**: as the operator you can read everything your users store in the instance. RLS isolates users from each other, not from the operator. If you serve other users, state this plainly in your Privacy Policy; in EU terms, you are the data controller for your instance.

---

## Step 1: Get your own copy of the code

Sylou is deployed from a GitHub repository that belongs to you, so start by making your copy.

1. Sign in to GitHub and open https://github.com/BenjaHardy/sylou
2. Ensure you are in the main (default) branch, then click **Fork** (top right), keep the defaults, and click **Create fork**.
3. Open your prompt console to clone your fork and install the dependencies:

```bash
git clone https://github.com/YOUR-USERNAME/sylou.git
cd sylou
npm ci
```

A fork of a public repository is also public. The repo holds no secrets: your keys live in Supabase and in the frontend host.

---

## Step 2 — Create a Supabase project

1. Sign in to [Supabase](https://supabase.com) and click **New project**.
2. Give the project a name (e.g. `sylou-myinstance`).
3. Choose a **region** close to your users. For EU-based users, Frankfurt (`eu-central-1`) is a good default.
4. Set a strong database password and save it somewhere safe: you won't need it for everyday Sylou operation, but you may need it later for direct database access.
5. Wait for the project to provision (1–2 minutes).

Once provisioned, take note of the following values from the Supabase dashboard:

- **Project ID**: visible in **Project Settings → General**. Looks like `abcdefghijklmnop`.
- **Project URL**: visible in **Project Overview**. Looks like `https://abcdefghijklmnop.supabase.co`.
- **Publishable (anon) key**: also in **Project Settings → API Keys (second tab)**. Starts with `eyJ...`.

You'll use these in the next steps.

---

## Step 3 — Link your local project to Supabase

In your terminal, from inside the `sylou` directory:

```bash
npx supabase login
```

This opens a browser for authentication.

Once logged in, link the local project to your Supabase project:

```bash
npx supabase link --project-ref YOUR-PROJECT-ID
```

Replace `YOUR-PROJECT-ID` with the value from Step 2.

---

## Step 4 — Set up the database

The Sylou repository includes the full database schema as migration files. Apply them all:

```bash
npx supabase db push
```

This creates all the tables, indexes, row-level security policies, database functions, and the storage bucket Sylou needs. The command should report each migration as applied; the whole process takes 10–20 seconds.

If you see errors, please [open an issue](https://github.com/BenjaHardy/sylou/issues) with the error output.

---

## Step 5 — Configure secrets

Sylou's edge functions read several configuration values as Supabase secrets. You'll set them now.

### Decide what you want enabled

Before setting secrets, decide:

- **Which LLM providers** you want available; Sylou currently works with Anthopic/Claude, Mistral, and Deepseek. 
Set the API key for each you wish to use; and you need to have at least either Anthropic/Claude or Mistral (recommended models for FLOW analysis). The provider whose key isn't set will appear in Sylou's model picker but fail at runtime if a user selects it; set keys for the providers you want users to actually have access to.

- **Whether you want web search.** Web search uses [Brave Search](https://api.search.brave.com); it's optional. If you don't set the Brave key, the web search toggle in Sylou's UI is greyed out with an explanatory tooltip.

### Set the secrets

In your terminal:

```bash
# LLM provider keys: set at least one
npx supabase secrets set ANTHROPIC_API_KEY=your-anthropic-key
npx supabase secrets set MISTRAL_API_KEY=your-mistral-key
npx supabase secrets set DEEPSEEK_API_KEY=your-deepseek-key

# Optional: web search
npx supabase secrets set BRAVE_SEARCH_API_KEY=your-brave-key

# CORS allow-list: the origin(s) where your Sylou frontend will be served
# Use your domain here once you know it:
npx supabase secrets set ALLOWED_ORIGIN=https://yourdomain.com
# If domain unknown, this step can be completed together with step 7.6.
# Multiple origins comma-separated, no trailing slashes, no paths.

# Instance metadata (shown on shared FLOW reports)
npx supabase secrets set SYLOU_INSTANCE_LABEL=self-hosted
npx supabase secrets set SYLOU_INSTANCE_DOMAIN=yourdomain.com
# If domain unknown, can be done together with step 7.6 or left unset
npx supabase secrets set SYLOU_VERSION=v0.7.0
git rev-parse --short HEAD
# returns the commit hash (7 characters) to be used in the next line
npx supabase secrets set SYLOU_COMMIT_HASH=RETURNED_COMMIT_HASH
```

A few notes:

- **`ALLOWED_ORIGIN`** is critical and is the most common source of setup problems. It must contain the *exact* origin(s) where your frontend will be deployed (scheme + host, no trailing slash, no path). For example: `https://sylou.acme.edu`, not `sylou.acme.edu` and not `https://sylou.acme.edu/`. If this is wrong, all backend calls from the browser will be blocked by CORS.
- **`SYLOU_INSTANCE_LABEL`** should remain `self-hosted` for any deployment other than the upstream Sylou project. The value `official` is reserved for the upstream project (in case it ever welcomes external users directly in the future). 
- **`SYLOU_VERSION` and `SYLOU_COMMIT_HASH`** appear in shared FLOW reports and the FLOW Pledge Badge so viewers can identify which version produced the report. Set them on each deploy: see [Deploys](#operating-your-instance) below.

You can verify the secrets were set:

```bash
npx supabase secrets list
```

The values are masked but the names should all appear.

---

## Step 6 — Deploy the edge functions

Sylou has eight edge functions that handle chat, FLOW analysis, document import, account deletion, and other backend work. Deploy them all:

```bash
npx supabase functions deploy
```

This deploys every function defined in the `supabase/functions/` directory. Each function takes 5–15 seconds. Once complete, you should see all eight listed as deployed in **Edge Functions** in your Supabase dashboard.

If you can't use the Supabase CLI for any reason, the same functions can be deployed manually via the Supabase dashboard's **Edge Functions** section. Note that dashboard deployment is significantly more fiddly (each function has multiple files, and the JWT verification toggle must be set manually for each; see `supabase/config.toml` for the correct settings). The CLI is strongly recommended.

---

## Step 7 — Build and host the frontend

The Sylou frontend is a static Vite-built React application. It can be deployed to any static web host.

### Quickest path: Vercel

1. Sign in to [Vercel](https://vercel.com) and click **Add New → Project**.
2. Import your GitHub repository; if needed, follow the steps to install Vercel on the repositary.
3. When invited, add the following **Environment Variables** (use the values from Step 2):

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT-ID-FROM-STEP-2.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-from-step-2
   ```

   `VITE_PUBLIC_SITE_URL` is optional; if unset, the frontend uses the browser's current origin, which is the right default for most deployments. Only set it if you need to override (e.g., a reverse proxy where the public URL differs from the deployed origin).

4. Click **Create Project**. Vercel handles the build and SPA routing automatically.
5. Note the deployed URL (e.g., `https://your-project.vercel.app` or your custom domain once configured).
6. **Important:** go back and update the `ALLOWED_ORIGIN` Supabase secret to include this URL exactly:

   ```bash
   npx supabase secrets set ALLOWED_ORIGIN=https://your-project.vercel.app
   # If you've already configured a custom domain, use that instead. If you use both, comma-separate them.
   
   # Likewise, SYLOU_INSTANCE_DOMAIN can also be updated with the deployed Vercel URL if no custom domain is used.
   npx supabase secrets set SYLOU_INSTANCE_DOMAIN=your-project.vercel.app
   # Unlike ALLOWED_ORIGIN, SYLOU_INSTANCE_DOMAIN can be left unset; if so the FLOW badge says "Generated by a self-hosted instance" and the report footer shows "(domain not configured)"
   ```

### Alternative: Cloudflare Pages

1. Sign in to [Cloudflare](https://dash.cloudflare.com), navigate to **Workers & Pages**, and create a new Pages project from your GitHub repository.
2. Set the build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Framework preset:** Vite (or None — Vite is supported either way)
3. Add the same environment variables listed in the Vercel section.
4. Deploy.
5. Update `ALLOWED_ORIGIN` to include the Cloudflare Pages URL.

### Other hosts

The frontend is a plain Vite SPA, it works on any static host. Some configuration points to be aware of:

- **SPA fallback routing**: your host must serve `index.html` for any unknown route. On Netlify, Cloudflare Pages, and Vercel this is automatic. On generic static hosts, you may need to configure a fallback rule (e.g., `_redirects` file for Netlify-compatible hosts).
- **Environment variables**: must be available at build time (Vite bakes them into the JS bundle), not just at runtime.
- **Shared-report headers**: serve `/report/*` with `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`: this keeps shared FLOW reports out of search-engine indices and keeps the token-bearing URL out of outbound referrers, while leaving the pages fully reachable (and machine-readable) for anyone holding a link. On Vercel this comes from `vercel.json`; Cloudflare Pages and Netlify pick it up automatically from the repo's `public/_headers`; on other hosts replicate it in your server config (e.g., an nginx `add_header` block for `location /report/`). Do **not** add a robots.txt `Disallow` for `/report/` instead — crawlers that can't fetch the page never see the `noindex`, so leaked links would still be indexable.

---

## Step 8 — First-run verification

This sequence confirms each major part of your Sylou instance is working, and can be run through after deployment.

**1. Sign in**

First create your Sylou account in **Supabase**. The quickest way is: 
Under **Authentication → Users → Add user**: *Create new user*: email + password, with **Auto Confirm User** ticked.

Open your deployed Sylou URL (Vercel deployed URL or custom domain). Sign in with the email and password chosen in Supabase just before (this is your operator account: you'll be the only user unless you choose to add others).

*Verifies: frontend is deployed, can reach Supabase, auth is working.*

**2. Acknowledge the disclaimer**

You'll see the first-use disclaimer modal, acknowledge it. The default screen will then show a quick summary of Sylou tips and functionalities. 

*Verifies: the disclaimer system is working.*

**3. Create your first project**

By clicking **+ New Project**.

*Verifies: projects can be created, the database is writable.*

**4. Type a paragraph**

Click into the editor and type a few sentences.

*Verifies: the editor renders and accepts input; provenance tracking (button on the top right) is recording your typing as `[t]`.*

**5. Send a chat message**

First choose a chat model in the settings: click on your account at the bottom left → Settings → Models tab. GLM 5.2 (through Mistral API) is the default model, so this is especially important if the Mistral API is not set.

*Verifies: the `chat` edge function is deployed and reachable, your LLM provider key is correct, CORS is configured properly. If this fails with a network error, the most likely cause is a mismatch between `ALLOWED_ORIGIN` and your actual deployed URL.*

**6. Use Ask or Propose**

In the editor, select a sentence you typed. In the contextual menu, click **Ask** or **Propose** and type a question about the selected text. Confirm a response appears (Ask -> in the chat; Propose -> in a dedicated window). Both Ask and Propose allow for context-aware AI feedback, meaning that prior to responding the LLM receives, in addition to the selected text, all relevant information from the project (writing contents and creative writing tools where applicable) to answer the query. 
You may also check that the other editor actions are working too, when selecting a sentence: Expand, Simplify, Rewrite, Fix grammar, Translate.

*Verifies: the `context-prompt` edge function is deployed correctly, the `editor-action` edge function is deployed correctly.*

**7. Try Tutor mode**

In the chat panel header, toggle on **Tutor mode**. Send another message. The response should be different in tone — Tutor mode guides rather than answers directly.

*Verifies: Tutor mode system prompts are correctly deployed.*

**8. Test a creative writing tool**

Create a second project, this time choosing the **Creative** template. Use one of the creative writing tools (Worldbuilding, Character Diagram, Timeline) in the dedicated tabs. Feel free to try and use Ask or Propose, it should have context awareness of both the creative tool contents and of the writing contents.

*Verifies: the creative template loads properly.*

**9. Run a FLOW analysis**

Go back to your first project. Click **Analyze with FLOW** at the bottom of the editor. The analysis runs (takes 30–60 seconds). When complete, a FLOW report appears.

*Verifies: the `analysis` edge function is deployed correctly. This is the most complex backend operation and exercises the LLM, the database, and the streaming response together.*

**10. Generate a shared report**

In the FLOW report view, toggle **Sharing** on. A public URL is generated. Open it in a private/incognito window to confirm it's publicly accessible.

*Verifies: the `share-report` edge function is working.*

**Optional: document import.** If you intend to use the document import feature, upload a PDF or text file in the chat panel's attachment area and confirm it loads. *(Verifies the `extract-text` edge function and the storage bucket setup.)*

**Optional: web search.** If you set `BRAVE_SEARCH_API_KEY`, toggle web search on in the chat panel and ask about a recent event. Confirm the response references current information. *(Verifies the Brave Search API key is correct.)*

If all the required steps work, your Sylou instance is correctly set up.

If any step fails, the [Troubleshooting](#troubleshooting) section below covers the most common causes.

---

## Operating your instance

A few things worth knowing once your Sylou instance is running.

### Managing users

Sylou's sign-in page has no self-registration: accounts exist only when the operator creates them, and users then sign in with email + password, set or reset through an email link. 

- **Close sign-ups** under **Authentication → Sign In/Providers**: "Allow new users to sign up" → off. Recommended for any deployment serving identified users; with it off, nothing outside your dashboard can create an account.
- **Set the auth URLs** under **Authentication → URL Configuration**: *Site URL* = your frontend origin (e.g. `https://sylou.example`), and add `https://sylou.example/**` to *Redirect URLs*. Without this, every email link redirects to Supabase's default `http://localhost:3000`.

**Creating accounts.** Under **Authentication → Users → Add user**:

- *Create new user*: email + a temporary password, with **Auto Confirm User** ticked. Sends no email; share the credentials out of band. The quickest path for a handful of users or testers.
- *Invite user*: sends an invitation email. Requires the email template change below, so the invitee lands on Sylou's set-password page (rather than straight in the app without a password).

**Email templates.** Sylou handles invitations and password resets on `/auth/set-password`. Under **Authentication → Emails → Templates (tab)**, point the links at that page (note: requires SMTP):

- *Invite user*: `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=invite`
- *Reset password*: `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=recovery`

(The default `{{ .ConfirmationURL }}` reset link also works, since the app requests that page as its redirect; the invitation link needs the template change.)

**Email sending limits.** Supabase's built-in mailer allows only a handful of auth emails per hour, project-wide, and deleting users does not reset the counter ("email rate limit exceeded"). Before inviting users in earnest, configure a custom provider under **Authentication → Emails → SMTP Settings** (Resend, Postmark and Brevo have free tiers); the limit under **Authentication → Rate Limits** becomes adjustable once custom SMTP is on.

**Password resets.** Users request one from the sign-in page ("Forgot password?"). Only existing accounts receive an email, and the page answers neutrally either way.

### Per-user token budgets

By default, new users have *no token budget*; they can use Sylou without limit. For multi-user deployments where LLM costs matter, you can set per-user budgets via direct SQL in the Supabase SQL editor:

```sql
-- Set a budget of 1 million tokens per calendar month for a specific user
UPDATE public.profiles
SET monthly_token_budget = 1000000
WHERE email = 'user@example.com';

-- Set the same budget for all users
UPDATE public.profiles
SET monthly_token_budget = 1000000;

-- Manually reset a user's usage counter mid-month (it otherwise resets
-- automatically at the start of each calendar month)
UPDATE public.profiles
SET tokens_used_this_period = 0
WHERE email = 'user@example.com';
```

To see usage:

```sql
-- Current usage and budget per user
SELECT email, tokens_used_this_period, monthly_token_budget
FROM public.profiles
ORDER BY tokens_used_this_period DESC;

-- Detailed usage from the token_usage table
SELECT user_id, function_name, model_used, SUM(input_tokens + output_tokens) as total_tokens
FROM public.token_usage
WHERE created_at > now() - interval '30 days'
GROUP BY user_id, function_name, model_used
ORDER BY total_tokens DESC;
```

### Updating to new Sylou versions

When you want to update to a newer Sylou release, simply go to your repository on GitHub, and click **Sync fork**
Then when using the prompt console in your local Sylou directory:

1. Pull the latest code: `git pull` in your local repository.
2. If there are new database migrations: `npx supabase db push`.
3. Redeploy the edge functions: `npx supabase functions deploy`.
4. Update the version secrets:
   ```bash
   npx supabase secrets set SYLOU_VERSION=v0.6.0  # or whatever the new release is
   git rev-parse --short HEAD
   npx supabase secrets set SYLOU_COMMIT_HASH=RETURNED_COMMIT_HASH
   ```
5. Your frontend host (Vercel/Cloudflare) auto-redeploys from GitHub.

The version and commit hash appear in shared FLOW reports, so keeping them updated lets viewers verify which version produced a given report.

---

## Troubleshooting

A few common issues and their fixes.

**Chat or analysis returns a network error in the browser.**

Almost always a CORS misconfiguration. Open your browser's developer tools, look at the Network tab, and find the failed request. Check the response headers for `Access-Control-Allow-Origin`: if it's missing or doesn't match your deployed URL exactly, update `ALLOWED_ORIGIN` to include the correct value (no trailing slash, no path). After updating, the change takes effect on the next request.

**Sign-in works but every backend call returns 403.**

You've hit the token budget. Either you're a user with a non-NULL budget that's been exceeded, or there's stale data. Check your profile in Supabase:

```sql
SELECT email, tokens_used_this_period, monthly_token_budget
FROM public.profiles WHERE email = 'your@email.com';
```

If `monthly_token_budget` is set and the usage exceeds it, either reset the usage counter or raise the budget.

**Chat returns "{provider} API key not configured".**

The user selected a model whose provider key isn't configured. Either set the key for that provider, or use a model from a provider whose key is set.

**`npx supabase db push` fails with permission errors.**

Confirm you're linked to the right project (`supabase status` shows the current linked project). If you're on a fresh project, this should work cleanly; if it doesn't, please open an issue.

**Edge functions deploy successfully but return 500 errors at runtime.**

Check the function logs in the Supabase dashboard under **Edge Functions → [function name] → Logs**. The most common cause is a missing secret.

**Web search returns no results even with `BRAVE_SEARCH_API_KEY` set.**

Confirm the key is correct (the Brave Search dashboard shows your usage; you should see requests appearing). Brave's free tier has request limits, so at higher usage, you may need to upgrade.

**Shared FLOW report URLs point to the wrong domain.**

You set `VITE_PUBLIC_SITE_URL` to a value that doesn't match where you actually deployed. Either remove the env var entirely (it defaults to the browser's current origin, which is usually correct) or update it to the right value and redeploy.

If you encounter something not in this list, please open an issue; the troubleshooting section may grow as real users encounter real problems.

---

## Getting help

- **Setup or deployment questions**: open an issue at [github.com/BenjaHardy/sylou/issues](https://github.com/BenjaHardy/sylou/issues).
- **Security issues**: please report privately per [SECURITY.md](../SECURITY.md), not in a public issue.
- **General questions**: [contact@sylou.eu](mailto:contact@sylou.eu).

Thanks for self-hosting Sylou.
