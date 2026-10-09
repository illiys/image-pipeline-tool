/**
 * While typing a project title: letters, digits, -, _, (, ), & and single spaces;
 * anything else becomes _.
 */
export function cleanTitleTyping(name: string): string {
  return name.replace(/[^\p{L}\p{N}_\-()& ]+/gu, '_').replace(/ {2,}/g, ' ')
}

/** Project titles (and so file names): the typing rules, with the ends trimmed. */
export function cleanTitle(name: string): string {
  return cleanTitleTyping(name.trim().replace(/\s+/g, ' '))
}
