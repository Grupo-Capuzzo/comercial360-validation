/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/backup.py. Na versão online não existe arquivo SQLite para copiar:
// os backups são feitos automaticamente pelo Supabase. As funções mantêm os nomes e
// o comportamento "sem backup" (criar_backup → null, como o Python faz quando não
// encontra o banco), para o resto do app seguir funcionando igual.

export const MSG_ONLINE = "Não se aplica na versão online: os backups são feitos automaticamente pelo Supabase.";

/** Equivale ao Path devolvido pelo Python (nome do arquivo de backup). */
export interface BackupGerado { name: string; path: string }

export async function criar_backup(_prefixo = "backup"): Promise<BackupGerado | null> {
  return null;
}

export async function listar_backups(): Promise<Record<string, any>[]> {
  return [];
}

export async function restaurar_backup(_caminho_backup: string): Promise<boolean> {
  return false;
}

export async function excluir_backup(_caminho_backup: string): Promise<boolean> {
  return false;
}

export async function limpar_backups_antigos(_manter_ultimos = 10): Promise<number> {
  return 0;
}
