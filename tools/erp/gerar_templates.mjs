// Gera src/erp/templates.gen.ts a partir de src/erp/templates/**/*.html
// Uso: node tools/erp/gerar_templates.mjs
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const pasta = path.join(raiz, "src/erp/templates");
const saida = path.join(raiz, "src/erp/templates.gen.ts");
const fontes = {};
(function andar(d) {
  for (const n of fs.readdirSync(d).sort()) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) andar(p);
    else if (n.endsWith(".html")) fontes[path.relative(pasta, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
  }
})(pasta);
const corpo = Object.entries(fontes).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
fs.writeFileSync(saida, `// @ts-nocheck\n/* eslint-disable */\n// ARQUIVO GERADO por tools/erp/gerar_templates.mjs — não editar à mão.\nexport const FONTES: Record<string, string> = {\n${corpo}\n};\n`);
console.log(`${Object.keys(fontes).length} templates → ${path.relative(raiz, saida)}`);
