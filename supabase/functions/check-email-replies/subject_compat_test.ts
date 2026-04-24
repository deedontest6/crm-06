import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { areSubjectsCompatible, normalizeSubjectRoot } from "../_shared/subject-normalize.ts";

Deno.test("Lukas case: unrelated subjects return false", () => {
  assertEquals(
    areSubjectsCompatible(
      "Re: Boosting Realthingks's Growth in EU",
      "Boosting Automotive Virtualization at Realthingks",
    ),
    false,
  );
});

Deno.test("Stacked prefixes: Re: Re: Fw: Hello vs Hello", () => {
  assertEquals(areSubjectsCompatible("Re: Re: Fw: Hello", "Hello"), true);
});

Deno.test("German prefix: AW: Angebot vs Angebot", () => {
  assertEquals(areSubjectsCompatible("AW: Angebot", "Angebot"), true);
});

Deno.test("Bracket tag: [EXT] Re: Proposal vs Proposal", () => {
  assertEquals(areSubjectsCompatible("[EXT] Re: Proposal", "Proposal"), true);
});

Deno.test("Bracket tag with ticket id: [#1234] Re: Quote vs Quote", () => {
  assertEquals(areSubjectsCompatible("[#1234] Re: Quote", "Quote"), true);
});

Deno.test("Mixed localized prefixes: WG: AW: Bericht vs Bericht", () => {
  assertEquals(areSubjectsCompatible("WG: AW: Bericht", "Bericht"), true);
});

Deno.test("Substring containment ≥ 8 chars matches", () => {
  assertEquals(
    areSubjectsCompatible(
      "Re: Boosting Automotive",
      "Boosting Automotive Virtualization at Realthingks",
    ),
    true,
  );
});

Deno.test("Typo tolerance via Jaccard: minor typos match", () => {
  // Token Jaccard between {boosting, automotive} and {boosting, automotive, virtualization} = 2/3 ≈ 0.67
  assertEquals(
    areSubjectsCompatible("Boosting Automotive", "Boosting Automotive Virtualization"),
    true,
  );
});

Deno.test("Empty / null safety", () => {
  assertEquals(areSubjectsCompatible(null, null), true);
  assertEquals(areSubjectsCompatible(undefined, "Hello"), true);
  assertEquals(areSubjectsCompatible("", "Hello"), true);
  assertEquals(areSubjectsCompatible("Hello", ""), true);
});

Deno.test("Unrelated short subjects return false", () => {
  assertEquals(areSubjectsCompatible("Lunch", "Pricing"), false);
});

Deno.test("normalizeSubjectRoot strips stacked prefixes and tags", () => {
  assertEquals(normalizeSubjectRoot("Re: Fw: [EXT] AW: Hello World!"), "hello world");
});

Deno.test("normalizeSubjectRoot handles unicode normalization", () => {
  // Composed vs decomposed é
  const composed = "Rép: Café";
  const decomposed = "Rép: Cafe\u0301"; // e + combining acute
  assertEquals(normalizeSubjectRoot(composed), normalizeSubjectRoot(decomposed));
});
