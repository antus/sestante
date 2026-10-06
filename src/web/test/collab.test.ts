import { describe, expect, it } from "vitest";
import { distinctPeople, type Participant } from "../src/lib/collab";

function participant(clientId: string, userId?: string, name = clientId): Participant {
  return {
    clientId,
    displayName: name,
    color: "#123456",
    role: "guest",
    editOverride: null,
    identity: userId ? { provider: "sestante", userId, username: name } : null,
  };
}

describe("presenza: dalle connessioni alle persone", () => {
  it("più schede dello stesso utente sono una persona sola", () => {
    const people = distinctPeople(
      [participant("c1", "anna", "Anna"), participant("c2", "anna", "Anna"), participant("c3", "bruno", "Bruno")],
      "c9",
      "io",
    );
    expect(people).toHaveLength(2);
    expect(people.find((p) => p.key === "anna")).toMatchObject({ connections: 2, verified: true, isSelf: false });
  });

  it("gli ospiti anonimi restano distinti fra loro", () => {
    const people = distinctPeople([participant("c1"), participant("c2")], "c9", null);
    expect(people.map((p) => p.key)).toEqual(["c1", "c2"]);
    expect(people.every((p) => !p.verified)).toBe(true);
  });

  it("riconosce sé stessi anche da un'altra scheda della stessa identità", () => {
    const people = distinctPeople([participant("altra-scheda", "io", "Io"), participant("c2", "bruno")], "questa-scheda", "io");
    expect(people.find((p) => p.key === "io")?.isSelf).toBe(true);
    expect(people.find((p) => p.key === "bruno")?.isSelf).toBe(false);
  });

  it("il server, host della sessione, non compare fra le persone", () => {
    const people = distinctPeople([participant("srv", "sestante:server", "Sestante"), participant("c1", "anna")], "c1", "anna");
    expect(people.map((p) => p.key)).toEqual(["anna"]);
  });

  it("il nome mostrato è quello verificato dal relay, non quello dichiarato", () => {
    const p = participant("c1", "anna", "Anna Verdi");
    p.displayName = "Mi spaccio per un altro";
    expect(distinctPeople([p], "x", null)[0]?.displayName).toBe("Anna Verdi");
  });
});
