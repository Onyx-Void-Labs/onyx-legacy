import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  type Options,
} from '@tauri-apps/plugin-notification';
import { IS_TAURI } from '../hooks/usePlatform';

/**
 * Request notification permission from the OS.
 * Returns true if granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!IS_TAURI) return false;

  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === 'granted';
  }
  return granted;
}

/**
 * Send a local notification for flashcard study reminders.
 */
export async function notifyFlashcardsDue(count: number): Promise<void> {
  if (!IS_TAURI || count <= 0) return;

  const granted = await ensureNotificationPermission();
  if (!granted) return;

  const options: Options = {
    title: 'Flashcards Due',
    body: `You have ${count} flashcard${count === 1 ? '' : 's'} ready for review.`,
    // Android channel (created automatically by tauri-plugin-notification)
    channelId: 'flashcard-reminders',
  };

  sendNotification(options);
}

/**
 * Send a generic Onyx notification.
 */
export async function notifyGeneric(title: string, body: string): Promise<void> {
  if (!IS_TAURI) return;

  const granted = await ensureNotificationPermission();
  if (!granted) return;

  sendNotification({ title, body });
}
