import { describe, it, expect } from "vitest";
import { guessMember, matchMembers } from "@/lib/linkApplication";

const mike = { id: "u-mike", full_name: "Mike Jones", email: "mike.jones@example.com" };
const other = { id: "u-other", full_name: "Someone Else", email: "someone@example.com" };

describe("picking the membership an application belongs to", () => {
  it("matches on the email address whatever the casing", () => {
    expect(guessMember({ email: "MIKE.JONES@Example.com " }, [other, mike])).toBe("u-mike");
  });

  it("falls back to a name when the email is a new one", () => {
    expect(guessMember({ full_name: "mike jones", email: "mike@newjob.com" }, [other, mike])).toBe(
      "u-mike",
    );
  });

  /*
   * The whole point of the picker. Two members of the same name is when a
   * guess would quietly file an application against the wrong person, so it
   * preselects nobody and makes somebody choose.
   */
  it("preselects nobody when two members share the name", () => {
    const twin = { id: "u-twin", full_name: "Mike Jones", email: "mj@example.com" };
    expect(guessMember({ full_name: "Mike Jones", email: "new@example.com" }, [mike, twin])).toBe("");
  });

  it("prefers the email match over a different person with the same name", () => {
    const twin = { id: "u-twin", full_name: "Mike Jones", email: "mj@example.com" };
    expect(guessMember({ full_name: "Mike Jones", email: "mj@example.com" }, [mike, twin])).toBe(
      "u-twin",
    );
  });

  it("preselects nobody when there is nothing to go on", () => {
    expect(guessMember({ full_name: "", email: "" }, [mike, other])).toBe("");
  });
});

describe("searching the member list", () => {
  const people = [
    { ...mike, phone: "+447700900123" },
    { ...other, phone: "" },
  ];

  it("returns everybody before anything is typed", () => {
    expect(matchMembers(people, "   ")).toHaveLength(2);
  });

  it("finds somebody by part of their number", () => {
    expect(matchMembers(people, "900123").map((m) => m.id)).toEqual(["u-mike"]);
  });

  it("finds somebody by part of their email", () => {
    expect(matchMembers(people, "SOMEONE@").map((m) => m.id)).toEqual(["u-other"]);
  });
});
