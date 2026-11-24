# Sylou on your own computer

There are two ways to run Sylou on your own computer, both with Docker:

- [**Sylou Local**](#sylou-local) is the whole of Sylou, packaged for one person on one computer: ready-made images, and a handful of commands to set it up, back it up and keep it updated.
- The [**developer setup**](#developer-setup) runs Supabase's local stack alongside `npm run dev`, for working on Sylou's code. It isn't meant for real writing.

---

## Sylou Local

### What to expect

Sylou Local is for one person, on one computer: it answers at http://localhost:8080, and only this computer can reach it.

Your writing stays in Docker on your computer. It only leaves it for the AI providers whose keys you add, and for web search when you turn it on. With models running on your computer, it doesn't have to leave at all.

A few things work a little differently from a hosted Sylou:

- There's no email: the links to set or reset a password are printed by the commands instead.
- Share links, and the QR codes on badges, only open on this computer.
- As you're the operator of your own install, the reports you make with it are self-attested ([TRANSPARENCY.md](../TRANSPARENCY.md), §7).

### What you'll need

- **Windows 11 with Docker Desktop**, or **Linux with Docker Engine** 28.3.3 or later. macOS isn't supported yet: it may well work, but it hasn't been tested.
- About 1 GB to download, 5 GB of disk space and 2 GB of free memory.
- An API key from at least one AI provider (Mistral, Anthropic or DeepSeek), or models running in [Ollama](https://ollama.com) on your computer (not yet on Linux). The FLOW analysis always runs on a cloud model.

Docker Desktop is free for personal use, education, non-commercial open source and small businesses (under 250 employees and $10 million in revenue); larger organisations need a [paid subscription](https://docs.docker.com/subscription/desktop-license/).

### Install

**1. Download the package.** From the [releases page](https://github.com/BenjaHardy/sylou/releases), download `sylou-local-<version>.zip` and `SHA256SUMS`, then check that the zip arrived intact:

```powershell
Get-FileHash sylou-local-<version>.zip    # Windows: compare with the line in SHA256SUMS
```

```bash
sha256sum -c SHA256SUMS                   # Linux
```

If you have the [GitHub CLI](https://cli.github.com), you can also check that the zip was built by this repository's release workflow:

```bash
gh attestation verify sylou-local-<version>.zip --repo BenjaHardy/sylou
```

**2. Unzip it** somewhere it can stay, outside OneDrive, iCloud, Dropbox or Google Drive: the folder will hold your install's secrets. Then open a terminal in the `sylou-local` folder (on Windows, right-click the folder and choose **Open in Terminal**).

**3. Run the setup** with your email address:

```powershell
.\sylou.cmd setup you@example.com    # Windows
```

```bash
./sylou setup you@example.com        # Linux
```

The setup checks Docker and port 8080, makes your install's secrets, starts Sylou and creates your account. The first run takes a few minutes, while Docker downloads the images. It ends with a one-time link: open it in your browser and choose a password of at least 15 characters. The link works once, within the hour.

**4. Sign in** at http://localhost:8080, and you're all set.

If Windows asks whether Docker may accept connections from the network, choose **Cancel**: Sylou doesn't need any. In Docker Desktop, we also recommend setting **Settings → Resources → Network → Port binding behavior** to **Localhost only**, which keeps the ports of your other containers on your computer too.

### Everyday commands

From the `sylou-local` folder, type `.\sylou.cmd <command>` on Windows, or `./sylou <command>` on Linux (below, simply `sylou`). On its own, `sylou` lists all its commands.

| Command | What it does |
|---|---|
| `sylou start` | Starts Sylou, and applies any settings or keys you've changed |
| `sylou stop` | Stops Sylou; nothing is deleted |
| `sylou status` | Shows what's running |
| `sylou logs [part]` | Shows the latest lines of each part's log, or of one part |
| `sylou add-user <email>` | Creates another account, with its one-time link |
| `sylou reset-password <email>` | Prints a one-time link to choose a new password |
| `sylou doctor` | Checks your install and the computer around it |
| `sylou backup <folder>` | Backs everything up into a new dated folder |
| `sylou restore <backup>` | Puts a backup back (see [Backups](#backups)) |
| `sylou update <folder>` | Backs up, then starts a new release (see [Updates](#updates)) |
| `sylou models <model>` | Fits an Ollama model to your graphics card |
| `sylou local-only on` / `off` | Keeps everything on this computer, or goes back to normal |
| `sylou rotate` | Makes new secrets for your install; everyone signs in again |
| `sylou remove` | Deletes your install's data, keeping `config/` |

The commands that can't be undone (`restore`, `rotate` and `remove`) ask you to type yes first. When Docker starts, Sylou starts with it if it was running; if you stopped it, it stays stopped.

### Settings and API keys

Your install keeps everything of its own in the `config` folder:

- `config/settings.env` holds the port, the local models and a few switches, each explained in the file. After a change, run `sylou start`.
- `config/secrets/` holds the passwords and keys made for your install, and your API keys, one file each. The setup makes this folder readable by your account only: never sync it, share it or paste it anywhere. If it may have leaked, run `sylou rotate`, and replace your API keys with their providers.

To add an API key, paste it on its own into its file, then run `sylou start`:

| File | Used for |
|---|---|
| `mistral_api_key` | Mistral and Z.ai models, including GLM 5.3, the default |
| `anthropic_api_key` | Claude models |
| `deepseek_api_key` | DeepSeek |
| `brave_search_api_key` | Web search in the chat |

### Local models (Ollama, Beta)

Sylou can use models running on your computer through [Ollama](https://ollama.com), for chat, Ask and Propose, editor actions and document summaries (not yet on Linux). They're smaller than cloud models, so expect simpler answers.

1. In Ollama, pull a model: `ollama pull mistral-nemo`.
2. Run `sylou models mistral-nemo`. It makes a copy of the model with the largest window your graphics card can run, which takes a few minutes, and prints the `OLLAMA_MODELS=` line to use.
3. In `config/settings.env`, set `OLLAMA_URL=http://host.docker.internal:11434` and paste that line (for several models, separate them with commas).
4. Run `sylou start`. Your models now appear first in the chat model picker, in Settings.

Ollama has no password, so keep it listening on your computer only, as it does by default: don't set `OLLAMA_HOST=0.0.0.0`, or expose it to the network. It's also worth setting `OLLAMA_NO_CLOUD=1` as an environment variable for your account, then restarting Ollama, so that a mistyped model name never ends up on Ollama's cloud ([how to set it](https://docs.ollama.com/faq)).

**Local-only mode.** For the strictest privacy, `sylou local-only on` cuts every part of Sylou that holds or reads your writing off from the internet: the only route left leads to Ollama, on your computer. Cloud models, FLOW and web search then tell you they're unavailable. One small container keeps a network with a way out, because Docker needs one to publish port 8080; it only passes bytes along to Sylou, and reads none of them. `sylou local-only off` brings the cloud back.

### Backups

Everything you write lives in Docker's storage, so uninstalling or resetting Docker would delete it: back up regularly. `sylou doctor` reminds you once your last backup is a month old.

```powershell
.\sylou.cmd backup D:\sylou-backups
```

A backup holds all your writing, your accounts (with passwords stored as hashes) and your imported documents, as plain files, so keep it somewhere private. It holds none of your install's secrets, API keys or sign-in sessions.

To restore a backup, on this computer or a new one:

1. If the install already has accounts, back up anything you want to keep, then run `sylou remove`: a backup only goes into an install without accounts.
2. Run `sylou setup` without an email address.
3. Run `sylou restore` with the backup's folder, for example `sylou restore D:\sylou-backups\sylou-2026-11-17-0930`.

Everyone then signs in again (on a new computer, add your API keys again too). It's safest to restore a backup with the release that made it, then update, so keep the previous release's zip until an update has worked.

### Updates

Updates bring new features and security fixes, and only reach your install when you install them. To hear about new releases, watch the repository's releases on GitHub (**Watch → Custom → Releases**); `sylou doctor` also lets you know once your release is more than four months old.

To update:

1. Download and check the new zip, as when you installed.
2. Unzip it over your `sylou-local` folder, replacing the files. Your `config` folder isn't in the zip, so your settings and secrets stay as they are.
3. Run `sylou update D:\sylou-backups`. It makes a backup first, then downloads the new images, updates the database and runs `sylou doctor`.

Each release's notes say what changed, and when an update includes a security fix. Every week, the newest release's images are also scanned again for newly published flaws.

### Health check

`sylou doctor` looks over your install and the computer around it: Docker's version, that Sylou only answers on this computer, Docker Desktop's port setting and the Windows firewall, Ollama, your release's age, your last backup, disk encryption, and who can read your secrets. Each finding comes with what to do about it. It never prints a secret, so its report is safe to paste into an issue if you need help (unlike anything from `config/`).

### Staying safe

- Sylou Local is meant for one person per computer: anyone with an account on the same computer can reach its sign-in page.
- Turn on disk encryption (BitLocker on Windows, LUKS on Linux): without it, whoever holds the computer can read your writing and your secrets.
- Keep Docker, your system and Sylou up to date.
- Nothing watches over your install in the background, so run `sylou doctor` now and then.
- If you find a security issue, please report it privately: see [SECURITY.md](../SECURITY.md).

### Checking the images

If you'd like to check what you run: `compose.yaml` names every image by its digest, so Docker always runs exactly those. Sylou's own three images (`ghcr.io/benjahardy/sylou-web`, `sylou-functions` and `sylou-tools`, for amd64 and arm64) are only ever published by this repository's release workflow, and you can verify them:

- `gh attestation verify oci://ghcr.io/benjahardy/sylou-web@<digest> --repo BenjaHardy/sylou` checks an image's signed provenance; the digests are in `compose.yaml` and in the release notes. The attestations are also listed in the repository, under **Actions → Attestations**.
- Each image carries an SBOM and its build provenance (`docker buildx imagetools inspect <image>@<digest> --format "{{json .SBOM}}"`), as well as the licences of everything it contains, in `/licenses`.
- The Dockerfiles are in [`sylou-local/`](../sylou-local), and any image scanner (Grype, Docker Scout…) can read the images.
- To build the images yourself instead, clone the repository at the release's tag and run the setup from its `sylou-local` folder: it then builds them from source.

The other images (Supabase's database, sign-in and storage, PostgREST and nginx) come from their own projects, also by digest.

### Removing Sylou Local

`sylou remove` deletes your install's data, keeping only `config/`. You can then delete the `sylou-local` folder, and Sylou's images in Docker (`docker image ls` lists them).

### Troubleshooting

| If you see | Try this |
|---|---|
| "Docker is installed but not running" | Start Docker Desktop, wait until it's running, and try again |
| "Something is already listening on 127.0.0.1:8080" | Stop that program (the developer setup also uses 8080), or choose another port with `SYLOU_PORT` |
| "Sylou did not start" | `sylou logs` shows what each part said, and `sylou doctor` checks the rest |
| "… API key not configured" | Paste the key into its file in `config/secrets/`, then run `sylou start` |
| Your local models don't show in Settings | Check that Ollama is running and that `OLLAMA_URL` and `OLLAMA_MODELS` are set, then run `sylou start` |
| A forgotten password | `sylou reset-password you@example.com` prints a link to choose a new one |

If something else goes wrong, please [open an issue](https://github.com/BenjaHardy/sylou/issues), with `sylou doctor`'s report if you can.

---

## Developer setup

Run the whole Sylou stack on your computer, for development and testing. The database, sign-in, file storage and the eight edge functions run in Docker through the Supabase CLI; the app runs with `npm run dev`. AI calls go to the providers' APIs with your own keys, or to Ollama on your computer.

> **For development only.** Supabase's local stack uses the same publicly known keys and database password on every computer, and its ports are open to your network unless a firewall blocks them. Don't keep real writing in it, don't run it on a network you don't trust, and stop it when you're done.

### Before you start

- Docker Desktop (Windows, macOS) or Docker Engine (Linux), running.
- Node.js 22.13 or later, and Git.
- The Supabase CLI (`npm install -g supabase`). Tested with 2.107.0.
- About 5 GB of free disk space, and about 3 GB of free memory while the stack runs (Docker Desktop included).
- **Firewall.** If Windows asks whether Docker Desktop (`com.docker.backend.exe`) or Node.js may accept connections on public or private networks, choose **Cancel**. On macOS and Linux, Docker opens the stack's ports to your network as well (on Linux, past `ufw`): use a network you trust.
- **A separate folder.** If you also deploy from a folder linked to a hosted Supabase project, clone the repository again for local work. In a linked folder, commands run without `--local` act on the hosted project.
- **One at a time.** Sylou Local uses port 8080 too, so stop one before starting the other.

### Set up

1. **Start the stack**, from the repository folder:

   ```bash
   supabase start
   ```

   The first start downloads the images (over 1 GB) and applies every migration. Later starts take under a minute. `supabase/config.toml` keeps the stack to the seven services Sylou uses.

2. **Give the functions their settings.** Copy `supabase/functions/.env.example` to `supabase/functions/.env` and set at least:

   ```
   ALLOWED_ORIGIN=http://localhost:8080
   SYLOU_INSTANCE_LABEL=local
   MISTRAL_API_KEY=your-key
   ```

   Add `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY` for those models, and `OLLAMA_URL` and `OLLAMA_MODELS` for models in Ollama (the file explains both). The functions read this file when the stack starts: after a change, run `supabase stop`, then `supabase start`.

3. **Point the app at the stack.** Run `supabase status` and create `.env.local` in the repository folder:

   ```
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_PUBLISHABLE_KEY=the-publishable-key-shown-by-supabase-status
   ```

4. **Create your account.** Sign-ups are closed, as on a hosted instance. In PowerShell:

   ```powershell
   $k = (supabase status -o json | ConvertFrom-Json).SERVICE_ROLE_KEY
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:54321/auth/v1/admin/users -Headers @{ apikey = $k; Authorization = "Bearer $k" } -ContentType 'application/json' -Body (@{ email = 'you@example.com'; password = 'choose-a-password'; email_confirm = $true } | ConvertTo-Json)
   ```

   In bash (macOS, Linux):

   ```bash
   k=$(supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')
   curl -X POST http://127.0.0.1:54321/auth/v1/admin/users -H "apikey: $k" -H "Authorization: Bearer $k" -H "Content-Type: application/json" -d '{"email":"you@example.com","password":"choose-a-password","email_confirm":true}'
   ```

5. **Run the app:**

   ```bash
   npm ci
   npm run dev
   ```

   Open http://localhost:8080 and sign in.

### Everyday use

- **Stop** with `supabase stop`: your data stays in Docker volumes. **Start again** with `supabase start`.
- **After your computer restarts**, Docker brings most of a running stack back by itself, but not the functions, and `supabase start` then reports it as already running. Run `supabase stop`, then `supabase start`. A stack you stopped stays stopped.
- **Emails** (password reset, invites) never leave your computer: read them at http://127.0.0.1:54324.
- **Function logs:** `docker logs -f supabase_edge_runtime_sylou`.
- **The dev server** listens on this computer only; `npm run dev -- --host` opens it to your network.

### Back up and restore

Back up the data and the uploaded files, from the repository folder (PowerShell shown; in bash, write `"$PWD:/backup"`):

```powershell
supabase db dump --local --data-only -f backup.sql
docker run --rm -v supabase_storage_sylou:/data:ro -v "${PWD}:/backup" alpine tar czf /backup/storage-files.tgz -C /data .
```

The two files hold all the writing and the accounts: keep them somewhere safe.

Restore into a fresh database. **This wipes the current one:**

```powershell
supabase db reset --local
docker cp backup.sql supabase_db_sylou:/tmp/backup.sql
docker exec supabase_db_sylou psql -U postgres -d postgres -q -f /tmp/backup.sql
docker run --rm -v supabase_storage_sylou:/data -v "${PWD}:/backup" alpine tar xzf /backup/storage-files.tgz -C /data
```

One error is expected: the `imports` storage bucket already exists, because the migrations create it.

### Update

```bash
git pull
npm ci
supabase migration up
```

`supabase migration up` applies the new migrations and keeps your data; `supabase db reset` wipes it. Back up before upgrading the Supabase CLI itself: an upgrade can require deleting the local data volumes.

### Troubleshooting

- **"… API key not configured"**: the key is missing from `supabase/functions/.env`, or the stack wasn't restarted after editing it.
- **"port is already allocated"**: another local Supabase stack, or Sylou Local, is running. Stop every stack with `supabase stop --all`, and Sylou Local with `sylou stop`.
- **The app can't reach the API**: check `.env.local`, then restart `npm run dev`.
