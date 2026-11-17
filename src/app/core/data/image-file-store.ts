import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const IMAGE_DIR = 'card-images';

/**
 * Native-only file storage for cached card images (ported from go-gather).
 * Bytes live under Directory.Cache/card-images/<sha256 of the key>, served
 * to the WebView via Capacitor.convertFileSrc; the storage engine tracks the
 * key, path, size and last view.
 *
 * Directory.Cache, not Data: images are re-downloadable and can add up to
 * gigabytes, which mustn't go into iCloud backups. iOS may purge the folder
 * when storage runs low; a purged image is simply downloaded again when next
 * shown (`getDisplayUrl` returns null).
 */
@Injectable({ providedIn: 'root' })
export class ImageFileStore {
  async writeImage(key: string, blob: Blob): Promise<{ filePath: string }> {
    const filePath = `${IMAGE_DIR}/${await hashKey(key)}`;
    await Filesystem.writeFile({
      path: filePath,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    return { filePath };
  }

  /** Whether the file is still there (one native call). */
  async exists(filePath: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: filePath, directory: Directory.Cache });
      return true;
    } catch {
      return false;
    }
  }

  /** A WebView-displayable URL for the file, or null if it's gone. */
  async getDisplayUrl(filePath: string): Promise<string | null> {
    try {
      await Filesystem.stat({ path: filePath, directory: Directory.Cache });
    } catch {
      return null;
    }
    const { uri } = await Filesystem.getUri({ path: filePath, directory: Directory.Cache });
    return Capacitor.convertFileSrc(uri);
  }

  async deleteImage(filePath: string): Promise<void> {
    await Filesystem.deleteFile({ path: filePath, directory: Directory.Cache }).catch(
      () => undefined // Already gone (e.g. purged by iOS).
    );
  }
}

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      resolve(separator >= 0 ? result.slice(separator + 1) : result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image.'));
    };
    reader.readAsDataURL(blob);
  });
}
