import { describe, it, expect } from "vitest";
import { parseSetPasswordLink, setPasswordRedirectUrl } from "@/lib/auth-links";

describe("parseSetPasswordLink", () => {
  it("accepts invitation and recovery links carrying a token hash", () => {
    expect(parseSetPasswordLink("?token_hash=abc123&type=invite")).toEqual({
      tokenHash: "abc123",
      type: "invite",
    });
    expect(parseSetPasswordLink("?type=recovery&token_hash=xyz")).toEqual({
      tokenHash: "xyz",
      type: "recovery",
    });
  });

  it("rejects links that are incomplete or of another type", () => {
    expect(parseSetPasswordLink("")).toBeNull();
    expect(parseSetPasswordLink("?token_hash=abc123")).toBeNull();
    expect(parseSetPasswordLink("?type=invite")).toBeNull();
    expect(parseSetPasswordLink("?token_hash=abc123&type=magiclink")).toBeNull();
    expect(parseSetPasswordLink("?token_hash=abc123&type=signup")).toBeNull();
    expect(parseSetPasswordLink("?token_hash=&type=invite")).toBeNull();
  });
});

describe("setPasswordRedirectUrl", () => {
  it("points password-reset emails at the set-password page of the given origin", () => {
    expect(setPasswordRedirectUrl("https://sylou.example")).toBe("https://sylou.example/auth/set-password");
  });
});
