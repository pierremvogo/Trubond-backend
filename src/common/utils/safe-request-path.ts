/**
 * Retourne uniquement le chemin d'une URL HTTP.
 * Évite d'exposer les paramètres de requête dans les journaux.
 */
export function safeRequestPath(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? '';
}
