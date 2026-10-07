export function normalizeSearch(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[—–\-.,()/:'"«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function matchesSearch(text: string, query: string) {
  const haystack = normalizeSearch(text);
  return normalizeSearch(query)
    .split(" ")
    .every((token) => haystack.includes(token));
}
