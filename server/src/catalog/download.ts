/**
 * The body as text, failing once it passes `maxBytes` (whatever the headers
 * say). `label` names the download in the error.
 */
export async function readCapped(
  response: Response,
  maxBytes: number,
  label: string
): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    throw new Error(`${label}: too large`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(`${label}: too large`);
    }
    text += decoder.decode(value, { stream: true });
  }
}
