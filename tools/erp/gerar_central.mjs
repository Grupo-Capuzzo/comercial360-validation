// Gera src/erp/base/central_html.gen.ts a partir de public/login-grupo/static/central.html
// (a página do Plano de ação é servida por /erp/central/plano sem ler o disco em tempo de execução).
// Uso: node tools/erp/gerar_central.mjs   (rode de novo sempre que mudar o central.html)
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const origem = path.join(raiz, "public/login-grupo/static/central.html");
const saida = path.join(raiz, "src/erp/base/central_html.gen.ts");
const html = fs.readFileSync(origem, "utf8");
fs.writeFileSync(saida, `/* eslint-disable */\n// ARQUIVO GERADO por tools/erp/gerar_central.mjs — não editar à mão.\nexport const CENTRAL_HTML: string = ${JSON.stringify(html)};\n`);
console.log(`central.html (${html.length} caracteres) → ${path.relative(raiz, saida)}`);
