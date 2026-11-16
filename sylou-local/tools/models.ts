// `sylou models <model>`: the largest window that still runs on the graphics
// card.
//
// Ollama gives every model a 4,096-token window unless it is told otherwise,
// and quietly drops whatever does not fit in it. Sylou refuses a model with
// no window of its own, so this makes one: a copy of the model you name, with
// a window written into it, as large as the card can hold.
//
// It tries 32k, then 16k, then 8k, and keeps the first that runs fully on the
// card. A0's trap is handled first: Ollama will answer a request for one copy
// with another copy of the same weights that is already loaded, so every copy
// is unloaded before a size is measured - otherwise the measurement is of
// something else entirely.

export interface LoadedModel {
  name: string;
  size?: number;
  size_vram?: number;
}

export interface GenerateResult {
  eval_count?: number;
  eval_duration?: number;
}

/** The windows to try, largest first. */
export const WINDOWS = [32768, 16384, 8192];

/** What a copy is called: the model, shortened, with its window. */
export function copyName(base: string, window: number): string {
  const stem = base.split(":")[0].split("/").pop() ?? base;
  return `sylou-${stem}-${Math.round(window / 1024)}k`;
}

/** Fully on the card: what Ollama says it put there against its whole size. */
export function fitsOnCard(loaded: LoadedModel | undefined): boolean {
  if (!loaded || !loaded.size) return false;
  const onCard = loaded.size_vram ?? 0;
  return onCard >= loaded.size * 0.99;
}

/** Tokens a second, from what a generation reported about itself. */
export function tokensPerSecond(result: GenerateResult): number | undefined {
  if (!result.eval_count || !result.eval_duration) return undefined;
  return result.eval_count / (result.eval_duration / 1_000_000_000);
}

/**
 * Below this, a model is being read by the processor rather than the card,
 * whatever Ollama reports: A0 measured about 3.3 tokens a second on the
 * processor against tens on the card.
 */
export const SLOW_TOKENS_PER_SECOND = 8;

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export interface Ollama {
  tags(): Promise<string[]>;
  loaded(): Promise<LoadedModel[]>;
  unload(name: string): Promise<void>;
  create(name: string, from: string, window: number): Promise<void>;
  warm(name: string): Promise<GenerateResult>;
  remove(name: string): Promise<void>;
}

/** Ollama over HTTP, with the one awkward call it has two spellings for. */
export function ollamaAt(address: string, fetcher?: Fetcher): Ollama {
  const call: Fetcher = fetcher ?? ((path, init) => fetch(`${address}${path}`, init));
  const json = async (path: string, body: unknown, method = "POST") => {
    const response = await call(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response;
  };

  return {
    async tags() {
      const response = await call("/api/tags");
      const body = await response.json().catch(() => ({}));
      return ((body as { models?: { name: string }[] }).models ?? []).map((model) => model.name);
    },
    async loaded() {
      const response = await call("/api/ps");
      const body = await response.json().catch(() => ({}));
      return (body as { models?: LoadedModel[] }).models ?? [];
    },
    async unload(name) {
      await json("/api/generate", { model: name, keep_alive: 0 });
    },
    async create(name, from, window) {
      // Newer Ollama takes the window as a parameter; older ones take a
      // Modelfile. Try the first, fall back to the second.
      const response = await json("/api/create", {
        model: name,
        from,
        parameters: { num_ctx: window },
      });
      if (response.ok) {
        await response.text();
        return;
      }
      await response.text().catch(() => "");
      const older = await json("/api/create", {
        name,
        modelfile: `FROM ${from}\nPARAMETER num_ctx ${window}\n`,
      });
      if (!older.ok) throw new Error(`Ollama would not make ${name} (${older.status})`);
      await older.text();
    },
    async warm(name) {
      const response = await json("/api/generate", {
        model: name,
        prompt: "Say ok.",
        stream: false,
        keep_alive: "2m",
        options: { num_predict: 16 },
      });
      if (!response.ok) throw new Error(`Ollama would not run ${name} (${response.status})`);
      return await response.json().catch(() => ({}));
    },
    async remove(name) {
      await json("/api/delete", { model: name, name }, "DELETE");
    },
  };
}

export interface Attempt {
  window: number;
  name: string;
  fits: boolean;
  tokensPerSecond?: number;
}

export interface Found {
  chosen?: Attempt;
  attempts: Attempt[];
}

/**
 * Makes a copy per window, largest first, and keeps the first that runs on
 * the card. Every copy of these weights is unloaded before each measurement.
 */
export async function findWindow(
  ollama: Ollama,
  base: string,
  windows: number[] = WINDOWS,
  log: (line: string) => void = console.log,
): Promise<Found> {
  const attempts: Attempt[] = [];
  let chosen: Attempt | undefined;

  for (const window of windows) {
    const name = copyName(base, window);
    log(`trying ${name} (${Math.round(window / 1024)}k)`);
    await ollama.create(name, base, window);

    // A0: Ollama answers for one copy with another that is already loaded,
    // so a measurement taken now would be of the wrong thing.
    for (const model of await ollama.loaded()) await ollama.unload(model.name);

    const result = await ollama.warm(name);
    const speed = tokensPerSecond(result);
    const loaded = (await ollama.loaded()).find((model) => model.name.startsWith(name));
    const fits = fitsOnCard(loaded) && (speed === undefined || speed >= SLOW_TOKENS_PER_SECOND);
    attempts.push({ window, name, fits, tokensPerSecond: speed });

    if (fits) {
      log(`  ${name} runs on the graphics card${speed ? `, about ${Math.round(speed)} tokens a second` : ""}`);
      chosen = attempts[attempts.length - 1];
      break;
    }
    log(`  ${name} does not fit the graphics card${speed ? `, about ${Math.round(speed)} tokens a second` : ""}; removing it`);
    await ollama.unload(name);
    await ollama.remove(name);
  }

  return { chosen, attempts };
}

export async function models(args: string[]): Promise<number> {
  const base = args[0] ?? "";
  if (!base) {
    console.error("models: name the model to make a window for, for example\n  sylou models mistral-nemo");
    return 2;
  }
  const address = (Deno.env.get("OLLAMA_URL") ?? "http://host.docker.internal:11434").replace(/\/+$/, "");
  const ollama = ollamaAt(address);

  try {
    const names = await ollama.tags();
    if (!names.some((name) => name === base || name.startsWith(`${base}:`))) {
      console.error(`models: Ollama does not have ${base}. Pull it first: ollama pull ${base}`);
      return 1;
    }
  } catch {
    console.error(`models: Ollama did not answer at ${address}.`);
    return 1;
  }

  const { chosen, attempts } = await findWindow(ollama, base);
  if (!chosen) {
    console.error(
      `models: none of ${attempts.map((attempt) => `${Math.round(attempt.window / 1024)}k`).join(", ")} ran on the ` +
        "graphics card. A smaller model would: this one is read by the processor, which takes minutes rather " +
        "than seconds.",
    );
    return 1;
  }

  console.log("");
  console.log(`models: ${chosen.name} is the one to use.`);
  console.log("Add it to OLLAMA_MODELS in config/settings.env, then run `sylou start` again:");
  console.log("");
  console.log(`  OLLAMA_MODELS=${chosen.name}`);
  console.log("");
  return 0;
}
