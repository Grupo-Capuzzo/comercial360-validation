import { ICONES } from "./icones";

/** Ícone SVG embutido, igual à função ic() do portal original. */
export function Ic({ nome }: { nome: string }) {
  return <svg className="ms" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONES[nome] ?? "" }} />;
}
