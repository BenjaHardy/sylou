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
- Optionally, a [Brave Search](https://api.search.brave.com) API key if you want web search inside Sylou
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
- **You'll likely need to write your own Terms of Use, Privacy Policy, and other documents** if you operate Sylou for anyone other than yourself.

See the [Operating your instance](#operating-your-instance) section near the end for more on this.

---

## Step 1 — Get the source code

Clone the Sylou repository to your local machine:

```bash
git clone https://github.com/BenjaHardy/sylou.git
cd sylou
```

Install the project's dependencies:

```bash
npm ci
```

This installs the frontend tooling and shouldn't take more than a minute or two.

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

Replace `YOUR-PROJECT-REF` with the value from Step 2.

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
Set the API key for each you wish to use; and you need to have at least either Anthropic/Claude or Mistral (recommended models for FLOW analysis). The provider whose key isn't set will appear in Sylou's model picker but fail at runtime if a user selects it (TO-DO: instance-level model allowlist); set keys for the providers you want users to actually have access to.

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
# If domain unknown, this step can be completed together with step 7.7.
# Multiple origins comma-separated, no trailing slashes, no paths.

# Instance metadata (shown on shared FLOW reports)
npx supabase secrets set SYLOU_INSTANCE_LABEL=self-hosted
npx supabase secrets set SYLOU_INSTANCE_DOMAIN=yourdomain.com
# If domain unknown, can be done together with step 7.7 or left unset
npx supabase secrets set SYLOU_VERSION=v0.7.0
git rev-parse --short HEAD
# returns the commit hash (7 characters) to be used in the next line
npx supabase secrets set SYLOU_COMMIT_HASH=RETURNED_COMMIT_HASH
```

A few notes:

- **`ALLOWED_ORIGIN`** is critical and is the most common source of setup problems. It must contain the *exact* origin(s) where your frontend will be deployed (scheme + host, no trailing slash, no path). For example: `https://sylou.acme.edu`, not `sylou.acme.edu` and not `https://sylou.acme.edu/`. If this is wrong, all backend calls from the browser will be blocked by CORS.
- **`SYLOU_INSTANCE_LABEL`** should remain `self-hosted` for any deployment other than the upstream Sylou project. The value `official` is reserved for the upstream project (in case it ever welcomes external users directly in the future). 
- **`SYLOU_VERSION` and `SYLOU_COMMIT_HASH`** appear in shared FLOW reports and the FLOW Pledge Badge so viewers can identify which version produced the report. Set them on each deploy: see [Deploys](#operating-your-instance) below.
- **You can leave any secret unset** and the system will use a safe default (the warning will appear in the function logs at startup so you can verify which keys are missing).

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

1. Push the Sylou code to a GitHub repository under your own account (fork the official repo or clone-and-push).
2. Sign in to [Vercel](https://vercel.com) and click **Add New → Project**.
3. Import your GitHub repository.
4. In the project settings, add the following **Environment Variables** (use the values from Step 2):

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-from-step-2
   ```

   `VITE_PUBLIC_SITE_URL` is optional — if unset, the frontend uses the browser's current origin, which is the right default for most deployments. Only set it if you need to override (e.g., a reverse proxy where the public URL differs from the deployed origin).

5. Click **Deploy**. Vercel handles the build and SPA routing automatically.
6. Note the deployed URL (e.g., `https://your-project.vercel.app` or your custom domain once configured).
7. **Important:** go back and update the `ALLOWED_ORIGIN` Supabase secret to include this URL exactly:

   ```bash
   npx supabase secrets set ALLOWED_ORIGIN=https://your-project.vercel.app
   # If you've already configured a custom domain, use that instead. If you use both, comma-separate them.
   
   # Likewise, SYLOU_INSTANCE_DOMAIN can also be updated with the deployed Vercel URL if no custom domain is used.
   npx supabase secrets set SYLOU_INSTANCE_DOMAIN=https://your-project.vercel.app
   # Alternatively can be left unset; if so the FLOW badge says "Generated by a self-hosted instance" and the report footer shows "(domain not configured)"
   ```

### Alternative: Cloudflare Pages

1. Push the Sylou code to a GitHub repository.
2. Sign in to [Cloudflare](https://dash.cloudflare.com), navigate to **Workers & Pages**, and create a new Pages project from your GitHub repository.
3. Set the build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Framework preset:** Vite (or None — Vite is supported either way)
4. Add the same environment variables listed in the Vercel section.
5. Deploy.
6. Update `ALLOWED_ORIGIN` to include the Cloudflare Pages URL.

### Other hosts

The frontend is a plain Vite SPA, it works on any static host. Two configuration points to be aware of:

- **SPA fallback routing**: your host must serve `index.html` for any unknown route. On Netlify, Cloudflare Pages, and Vercel this is automatic. On generic static hosts, you may need to configure a fallback rule (e.g., `_redirects` file for Netlify-compatible hosts).
- **Environment variables**: must be available at build time (Vite bakes them into the JS bundle), not just at runtime.
- **Shared-report headers**: serve `/report/*` with `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer` — this keeps shared FLOW reports out of search-engine indices and keeps the token-bearing URL out of outbound referrers, while leaving the pages fully reachable (and machine-readable) for anyone holding a link. On Vercel this comes from `vercel.json`; Cloudflare Pages and Netlify pick it up automatically from the repo's `public/_headers`; on other hosts replicate it in your server config (e.g., an nginx `add_header` block for `location /report/`). Do **not** add a robots.txt `Disallow` for `/report/` instead — crawlers that can't fetch the page never see the `noindex`, so leaked links would still be indexable.

---

## Step 8 — First-run verification

This sequence confirms each major part of your Sylou instance is working. Run through it after deployment — each step also tells you which underlying component it verifies, which helps with debugging later.

**1. Sign in**

Open your deployed Sylou URL. Sign up with an email and password (this is your operator account — you'll be the only user unless you choose to add others).

*Verifies: frontend is deployed, can reach Supabase, auth is working.*

**2. Acknowledge the disclaimer**

You'll see the first-use disclaimer modal. Acknowledge it.

*Verifies: the disclaimer system is working.*

**3. Create your first project**

Click **+ New Project**. Use the **General** template. Give it a name.

*Verifies: projects can be created, the database is writable.*

**4. Type a paragraph**

Click into the editor and type a few sentences.

*Verifies: the editor renders and accepts input; provenance tracking is recording your typing as `[t]`.*

**5. Send a chat message**

In the chat panel on the right, type something like *"Suggest three angles for an essay on climate adaptation."* Send it.

*Verifies: the `chat` edge function is deployed and reachable, your LLM provider key is correct, CORS is configured properly. If this fails with a network error, the most likely cause is a mismatch between `ALLOWED_ORIGIN` and your actual deployed URL.*

**6. Use Ask or Propose**

In the editor, select a sentence you typed. In the contextual menu, click **Ask** or **Propose** and type a question about the selected text. Confirm a response appears (Ask -> in the chat; Propose -> in a dedicated window).
You may also check that the other editor actions are working too, when selecting a sentence: Expand, Simplify, Rephrase, Fix grammar, Translate.

*Verifies: the `context-prompt` edge function is deployed correctly, the `editor-action` edge function is deployed correctly.*

**7. Try Tutor mode**

In the chat panel header, toggle on **Tutor mode**. Send another message. The response should be different in tone — Tutor mode guides rather than answers directly.

*Verifies: Tutor mode system prompts are correctly deployed.*

**8. Test a creative writing tool**

Create a second project, this time choosing the **Creative** template. Use one of the creative writing tools (Worldbuilding, Character Diagram, Timeline) in the dedicated tabs. Feel free to try and use Ask, it should have context awareness of the creative tool contents and of the writing contents.

*Verifies: the creative template loads properly.*

**9. Run a FLOW analysis**

Go back to your first project. Click **Analyze with FLOW** at the bottom of the editor. The analysis runs (takes 30–60 seconds). When complete, a FLOW report appears.

*Verifies: the `analysis` edge function is deployed correctly. This is the most complex backend operation and exercises the LLM, the database, and the streaming response together.*

**10. Generate a shared report**

In the FLOW report view, toggle **Sharing** on. A public URL is generated. Open it in a private/incognito window to confirm it's publicly accessible.

*Verifies: the `share-report` edge function is working and the public-read RLS policies are correctly applied.*

**Optional: document import.** If you intend to use the document import feature, upload a PDF or text file in the chat panel's attachment area and confirm it loads. *(Verifies the `extract-text` edge function and the storage bucket setup.)*

**Optional: web search.** If you set `BRAVE_SEARCH_API_KEY`, toggle web search on in the chat panel and ask about a recent event. Confirm the response references current information. *(Verifies the Brave Search API key is correct.)*

If all the required steps work, your Sylou instance is correctly set up.

If any step fails, the [Troubleshooting](#troubleshooting) section below covers the most common causes.

---

## Operating your instance

A few things worth knowing once your Sylou instance is running.

### Managing users

Sylou's sign-in page has no self-registration: accounts exist only when the operator creates them, and users then sign in with email + password, set or reset through an email link. Two settings make that explicit and fail-closed:

- **Close sign-ups** under **Authentication → Providers → Email** ("Allow new users to sign up" off). Recommended for any deployment serving identified users; with it off, nothing outside your dashboard can create an account.
- **Set the auth URLs** under **Authentication → URL Configuration**: *Site URL* = your frontend origin (e.g. `https://sylou.example`), and add `https://sylou.example/**` to *Redirect URLs*. Without this, every email link redirects to Supabase's default `http://localhost:3000`.

**Creating accounts.** Under **Authentication → Users → Add user**:

- *Create new user* — email + a temporary password, with **Auto Confirm User** ticked. Sends no email; share the credentials out of band. The quickest path for a handful of users or testers.
- *Invite user* — sends an invitation email. Requires the template change below, so the invitee lands on Sylou's set-password page rather than straight in the app without a password.

**Email templates.** Sylou handles invitations and password resets on `/auth/set-password`. Under **Authentication → Email Templates**, point the links at that page:

- *Invite user*: `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=invite`
- *Reset password*: `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=recovery`

(The default `{{ .ConfirmationURL }}` reset link also works, since the app requests that page as its redirect; the invitation link needs the template change.)

**Email sending limits.** Supabase's built-in mailer allows only a handful of auth emails per hour, project-wide, and deleting users does not reset the counter ("email rate limit exceeded"). Before inviting users in earnest, configure a custom provider under **Authentication → Emails → SMTP Settings** (Resend, Postmark and Brevo have free tiers); the limit under **Authentication → Rate Limits** becomes adjustable once custom SMTP is on.

**Password resets.** Users request one from the sign-in page ("Forgot password?"). Only existing accounts receive an email, and the page answers neutrally either way.

### Per-user token budgets

By default, new users have *no token budget* — they can use Sylou without limit. For multi-user deployments where LLM costs matter, you can set per-user budgets via direct SQL in the Supabase SQL editor:

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

There is no admin UI for this today. The budget mechanism enforces limits in real time — once a user reaches their budget, further LLM calls return HTTP 403 until the start of the next calendar month (when the counter resets automatically), or until you raise the budget or manually reset the counter.

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

### Additional cost & abuse protection

Sylou has no built-in per-user *request* throttle — cost is bounded by the per-user token budget above. For additional protection against cost or abuse, use platform-layer controls:

- **Supabase auth rate limits** (Dashboard → Authentication → Rate Limits) to throttle sign-ups and sign-ins — important if you leave sign-ups open.
- **A WAF / CDN** (e.g. Cloudflare) in front of your frontend and your Supabase project.

The per-user budget caps an individual's spend; combine it with closed sign-ups (above) or auth rate limits to bound aggregate cost across many users.

### Updating to new Sylou versions

When you want to update to a newer Sylou release:

1. Pull the latest code: `git pull` in your local repository.
2. If there are new database migrations: `supabase db push`.
3. Redeploy the edge functions: `supabase functions deploy`.
4. Update the version secrets:
   ```bash
   supabase secrets set SYLOU_VERSION=v0.6.0  # or whatever the new release is
   supabase secrets set SYLOU_COMMIT_HASH=$(git rev-parse --short HEAD)
   ```
5. Push the updated code to your frontend host (Vercel/Cloudflare auto-redeploys from GitHub).

The version and commit hash appear in shared FLOW reports, so keeping them updated lets viewers verify which version produced a given report.

### Operator responsibilities

A few things to be aware of as an operator:

- **AI Act position**: see [docs/ai-act-position.md](ai-act-position.md). If you operate Sylou for users other than yourself, you may have your own obligations under the EU AI Act. The transparency measures shipped with Sylou are designed to support a self-hoster's compliance posture, but cannot substitute for the self-hoster's own responsibilities.
- **Terms of Use and Privacy Policy**: if you serve other users, you'll likely want both. Template documents are planned for the repo; for now, consult your own legal advisor if your deployment scale warrants it.
- **Database-level data access (disclose it)**: as the operator you can read everything your users store in the instance — the Supabase dashboard, the SQL editor, and the service-role key all bypass row-level security by design. RLS isolates users from *each other*, not from the operator. If you serve other users, state this plainly in your Privacy Policy; in EU terms, you are the data controller for your instance.
- **Account deletion / right to erasure**: users can permanently delete their own account in-app (**Settings → Account → Delete account**, typed confirmation). The `delete-account` edge function first purges the user's files under **Storage → imports → `<user-id>/`** (storage objects do not cascade automatically), then deletes the auth user — the database schema cascades from there (projects, writing, chat, FLOW reports; shared report links stop working). Deletions appear in the function's logs as a single non-PII line (user id + file count). The manual operator path still works as a fallback: delete the user under **Authentication → Users**, then remove their files under **Storage → imports → `<user-id>/`**. Factor deletion into your privacy commitments if you serve other users, especially in the EU.
- **Before opening registration to others**: three switches are worth flipping first. (1) Set a per-user `monthly_token_budget` (see [Per-user token budgets](#per-user-token-budgets)) — the default is *unlimited*, and the budget is the instance's only built-in cost lever. (2) Enable **leaked-password protection** (Dashboard → **Authentication → Passwords**) so sign-ups can't use known-breached passwords. (3) Review the sign-up mode and auth rate limits (see [Additional cost & abuse protection](#additional-cost--abuse-protection)).
- **Trademark**: see [TRADEMARK-POLICY.md](../TRADEMARK-POLICY.md). Self-hosting unmodified Sylou under the Sylou name is welcomed; substantive modifications need a different name.
- **Backups**: Supabase provides automated backups on paid plans. For a personal or small-team instance, the free tier's recovery options may be limited — verify what's available on your plan before depending on it.

---

## Troubleshooting

A few common issues and their fixes.

**Chat or analysis returns a network error in the browser.**

Almost always a CORS misconfiguration. Open your browser's developer tools, look at the Network tab, and find the failed request. Check the response headers for `Access-Control-Allow-Origin` — if it's missing or doesn't match your deployed URL exactly, update `ALLOWED_ORIGIN` to include the correct value (no trailing slash, no path). After updating, the change takes effect on the next request.

**Sign-in works but every backend call returns 403.**

You've hit the token budget. Either you're a user with a non-NULL budget that's been exceeded, or there's stale data. Check your profile:

```sql
SELECT email, tokens_used_this_period, monthly_token_budget
FROM public.profiles WHERE email = 'your@email.com';
```

If `monthly_token_budget` is set and the usage exceeds it, either reset the usage counter or raise the budget.

**Chat returns "Missing API key for {provider}".**

The user selected a model whose provider key isn't configured. Either set the key for that provider, or use a model from a provider whose key is set.

**`supabase db push` fails with permission errors.**

Confirm you're linked to the right project (`supabase status` shows the current linked project). If you're on a fresh project, this should work cleanly; if it doesn't, please open an issue.

**Edge functions deploy successfully but return 500 errors at runtime.**

Check the function logs in the Supabase dashboard under **Edge Functions → [function name] → Logs**. The most common cause is a missing secret — the function startup log will tell you which.

**Web search returns no results even with `BRAVE_SEARCH_API_KEY` set.**

Confirm the key is correct (the Brave Search dashboard shows your usage; you should see requests appearing). Brave's free tier has request limits — at higher usage, you may need to upgrade.

**Shared FLOW report URLs point to the wrong domain.**

You set `VITE_PUBLIC_SITE_URL` to a value that doesn't match where you actually deployed. Either remove the env var entirely (it defaults to the browser's current origin, which is usually correct) or update it to the right value and redeploy.

If you encounter something not in this list, please open an issue — the troubleshooting section grows as real users encounter real problems.

---

## Getting help

- **Setup or deployment questions**: open an issue at [github.com/BenjaHardy/sylou/issues](https://github.com/BenjaHardy/sylou/issues).
- **Security issues**: please report privately per [SECURITY.md](../SECURITY.md), not in a public issue.
- **General questions**: [contact@sylou.eu](mailto:contact@sylou.eu).

Thanks for self-hosting Sylou.
