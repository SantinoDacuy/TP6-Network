import { createServer } from "./server.mjs";
console.log("Laboratorio local. Token: tp6-demo-local-2026");
console.log(
  "En un teléfono físico configurá http://IP-DE-TU-PC:8787. En emulador: http://10.0.2.2:8787."
);
const server = await createServer({
  dataDir: "./backend/data",
  token: "tp6-demo-local-2026",
});
server.listen(8787, "0.0.0.0", () =>
  console.log("Backend de demostración en puerto 8787. Ctrl+C para detener.")
);
