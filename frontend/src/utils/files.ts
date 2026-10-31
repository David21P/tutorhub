import { api } from '../api/client';

/** Descarga un archivo protegido (requiere JWT) y lo abre en una pestaña nueva. */
export async function openFile(fileId: string): Promise<void> {
  const res = await api.get<Blob>(`/files/${fileId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
