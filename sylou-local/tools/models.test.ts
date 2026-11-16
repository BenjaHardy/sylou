// The window finder, against an Ollama that is not there: which window it
// keeps, what it removes, and the order of the calls - which is the part A0
// had to find out the hard way.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  copyName,
  findWindow,
  fitsOnCard,
  type LoadedModel,
  type Ollama,
  SLOW_TOKENS_PER_SECOND,
  tokensPerSecond,
  WINDOWS,
} from "./models.ts";

/** An Ollama with a graphics card of a size we decide. */
function fakeOllama(options: { fitsUpTo: number; speed?: number; size?: number }) {
  const calls: string[] = [];
  let loaded: LoadedModel[] = [];
  const made = new Set<string>();
  const size = options.size ?? 8_000_000_000;

  const ollama: Ollama = {
    tags: () => {
      calls.push("tags");
      return Promise.resolve(["mistral-nemo:latest"]);
    },
    loaded: () => {
      calls.push("loaded");
      return Promise.resolve([...loaded]);
    },
    unload: (name) => {
      calls.push(`unload ${name}`);
      loaded = loaded.filter((model) => model.name !== name);
      return Promise.resolve();
    },
    create: (name, from, window) => {
      calls.push(`create ${name} from ${from} at ${window}`);
      made.add(name);
      return Promise.resolve();
    },
    warm: (name) => {
      calls.push(`warm ${name}`);
      const window = Number(name.match(/-(\d+)k$/)?.[1] ?? 0) * 1024;
      const onCard = window <= options.fitsUpTo;
      loaded = [{ name: `${name}:latest`, size, size_vram: onCard ? size : Math.floor(size / 2) }];
      const speed = options.speed ?? (onCard ? 40 : 3);
      return Promise.resolve({ eval_count: speed * 2, eval_duration: 2_000_000_000 });
    },
    remove: (name) => {
      calls.push(`remove ${name}`);
      made.delete(name);
      return Promise.resolve();
    },
  };
  return { ollama, calls, made };
}

Deno.test("a copy is named for its model and its window", () => {
  assertEquals(copyName("mistral-nemo", 16384), "sylou-mistral-nemo-16k");
  assertEquals(copyName("mistral-nemo:latest", 8192), "sylou-mistral-nemo-8k");
  assertEquals(copyName("library/gemma4:12b", 32768), "sylou-gemma4-32k");
});

Deno.test("fitting the card means all of it is on the card", () => {
  assert(fitsOnCard({ name: "x", size: 100, size_vram: 100 }));
  assert(!fitsOnCard({ name: "x", size: 100, size_vram: 60 }));
  assert(!fitsOnCard({ name: "x", size: 100 }));
  assert(!fitsOnCard(undefined));
});

Deno.test("speed is read from what the generation said about itself", () => {
  assertEquals(tokensPerSecond({ eval_count: 40, eval_duration: 2_000_000_000 }), 20);
  assertEquals(tokensPerSecond({ eval_count: 0, eval_duration: 1 }), undefined);
  assertEquals(tokensPerSecond({}), undefined);
});

Deno.test("the largest window that fits is the one kept", async () => {
  const { ollama, calls, made } = fakeOllama({ fitsUpTo: 16384 });
  const { chosen, attempts } = await findWindow(ollama, "mistral-nemo", WINDOWS, () => {});

  assertEquals(chosen?.name, "sylou-mistral-nemo-16k");
  assertEquals(attempts.map((attempt) => attempt.window), [32768, 16384]);
  // The one that did not fit was taken away again; the one that did stayed.
  assert(calls.includes("remove sylou-mistral-nemo-32k"));
  assert(!calls.includes("remove sylou-mistral-nemo-16k"));
  assertEquals([...made], ["sylou-mistral-nemo-16k"]);
});

Deno.test("every copy is unloaded before a size is measured (A0's trap)", async () => {
  const { ollama, calls } = await Promise.resolve(fakeOllama({ fitsUpTo: 8192 }));
  await findWindow(ollama, "mistral-nemo", [32768, 8192], () => {});

  // For each attempt: create, then look at what is loaded, then unload it,
  // and only then warm the copy being measured.
  const create = calls.indexOf("create sylou-mistral-nemo-32k from mistral-nemo at 32768");
  const warm = calls.indexOf("warm sylou-mistral-nemo-32k");
  const lookedBetween = calls.slice(create, warm);
  assert(lookedBetween.includes("loaded"), "it measured without looking at what was already loaded");

  // The second attempt unloads the first copy before measuring its own.
  const secondWarm = calls.indexOf("warm sylou-mistral-nemo-8k");
  const before = calls.slice(0, secondWarm);
  assert(
    before.some((call) => call.startsWith("unload sylou-mistral-nemo-32k")),
    "the copy from the first attempt was still loaded when the second was measured",
  );
});

Deno.test("a model that only the processor can hold is not kept", async () => {
  const { ollama, made } = fakeOllama({ fitsUpTo: 0 });
  const { chosen, attempts } = await findWindow(ollama, "big-one", WINDOWS, () => {});
  assertEquals(chosen, undefined);
  assertEquals(attempts.length, 3);
  assertEquals([...made], []);
});

Deno.test("Ollama saying it is on the card is not enough when it answers at a crawl", async () => {
  // A0: /api/ps under-reported one model's size, so the speed decides too.
  const { ollama } = fakeOllama({ fitsUpTo: 32768, speed: SLOW_TOKENS_PER_SECOND - 5 });
  const { chosen } = await findWindow(ollama, "mistral-nemo", [32768], () => {});
  assertEquals(chosen, undefined);
});
