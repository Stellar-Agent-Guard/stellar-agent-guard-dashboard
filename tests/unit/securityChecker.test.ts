import { findFlagged, isFlagged, findFlaggedInDraft, registryVersion } from "../../lib/guard/securityChecker";

describe("securityChecker", () => {
  test("isFlagged returns true for known flagged address", () => {
    expect(isFlagged("GBADFLAGEXAMPLE000000000000000000000000000000000000000")).toBe(true);
  });

  test("findFlagged finds flagged addresses in array", () => {
    const found = findFlagged(["GPHISHINGADDR0000000000000000000000000000000000000000", "GOK"]);
    expect(found).toContain("GPHISHINGADDR0000000000000000000000000000000000000000");
  });

  test("findFlaggedInDraft detects flagged addresses in form fields", () => {
    const draft = {
      assets: "GBADFLAGEXAMPLE000000000000000000000000000000000000000\nGOKASSET",
      recipients: "GPHISHINGADDR0000000000000000000000000000000000000000",
      protocols: "GOKPROTO\nGBADFLAGEXAMPLE000000000000000000000000000000000000000:swap",
    };
    const found = findFlaggedInDraft(draft);
    expect(found.sort()).toEqual([
      "GBADFLAGEXAMPLE000000000000000000000000000000000000000",
      "GPHISHINGADDR0000000000000000000000000000000000000000",
    ].sort());
  });

  test("registryVersion is populated", () => {
    expect(registryVersion()).toMatch(/2026/);
  });
});
