// Push Notifications Library for STC Play
// Handles subscription and permission for Web Push on iOS/Android PWAs

// VAPID public key - generated for this project
// Private key (store securely for backend): H-woFjW3qgPezjgtgyYVe8MAEpbHwq0htW3PibITtAs
const VAPID_PUBLIC_KEY = 'BLnOCELBk2YT3FlawO9KimRA0lrWRMO98zFzttXdrK6L_lW9yUXTvsVHZWEPKKtle1jSPwlPU3e97w6qT06p8qQ';

interface PushSubscriptionData {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

/**
 * Check if push notifications are supported on this device/browser
 */
export function isPushSupported(): boolean {
    return (
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );
}

/**
 * Check if running as installed PWA (home screen)
 */
export function isInstalledPWA(): boolean {
    // Check for iOS standalone mode
    const isIOSStandalone = (window.navigator as any).standalone === true;

    // Check for other browsers' display-mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    return isIOSStandalone || isStandalone;
}

/**
 * Check if running on iOS
 */
export function isIOS(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

/**
 * Get the current notification permission status
 */
export function getPermissionStatus(): NotificationPermission {
    if (!('Notification' in window)) return 'denied';
    return Notification.permission;
}

/**
 * Request permission and subscribe to push notifications
 * Must be called from a user gesture (button click)
 */
export async function subscribeToPush(): Promise<PushSubscriptionData | null> {
    if (!isPushSupported()) {
        console.warn('[Push] Push notifications not supported');
        return null;
    }

    try {
        // Request notification permission
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') {
            console.log('[Push] Permission denied');
            return null;
        }

        // Wait for service worker to be ready
        const registration = await navigator.serviceWorker.ready;

        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            // Subscribe with VAPID key
            const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedKey
            });
        }

        // Extract subscription data
        const subscriptionData: PushSubscriptionData = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
                auth: arrayBufferToBase64(subscription.getKey('auth'))
            }
        };

        console.log('[Push] Subscribed successfully:', subscriptionData.endpoint);
        return subscriptionData;

    } catch (error) {
        console.error('[Push] Subscription failed:', error);
        return null;
    }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            await subscription.unsubscribe();
            console.log('[Push] Unsubscribed successfully');
            return true;
        }

        return false;
    } catch (error) {
        console.error('[Push] Unsubscribe failed:', error);
        return false;
    }
}

/**
 * Check if currently subscribed to push
 */
export async function isSubscribed(): Promise<boolean> {
    if (!isPushSupported()) return false;

    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        return subscription !== null;
    } catch {
        return false;
    }
}

// Helper: Convert VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray as Uint8Array<ArrayBuffer>;
}

// Helper: Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}
