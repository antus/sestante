/**
 * Avvia server e client insieme, con un prefisso per riga così si capisce da
 * dove arriva ogni messaggio. Nessuna dipendenza: `concurrently` farebbe la
 * stessa cosa con un pacchetto in più da installare su ogni postazione.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (!existsSync(resolve(root, "node_modules"))) {
  console.error("\n  Dipendenze non installate. Esegui prima:  npm run setup\n");
  process.exit(1);
}
if (!existsSync(resolve(root, ".out/data/sestante.sqlite"))) {
  console.log("\n  Database assente: lo creo con i dati di esempio…\n");
  const seed = spawn(npm, ["run", "db:reset"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  seed.on("exit", start);
} else {
  start();
}

function start() {
  const children = [
    { label: "server", color: "[36m", args: ["run", "dev", "-w", "@sestante/server"] },
    { label: "client", color: "[35m", args: ["run", "dev", "-w", "@sestante/web"] },
  ].map(({ label, color, args }) => {
    const child = spawn(npm, args, {
      cwd: root,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const prefix = `${color}${label.padEnd(6)}[0m │ `;
    const pipe = (stream, target) => {
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) target.write(`${prefix}${line}\n`);
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    return child;
  });

  const stop = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(
    [
      "",
      "  Sestante in sviluppo",
      "    client   http://localhost:5173",
      "    API      http://localhost:4000",
      "",
      "  Accedi con  m.antonini@example.org / sestante2026",
      "  Ctrl+C per fermare tutto.",
      "",
    ].join("\n"),
  );
}
