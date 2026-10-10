import Storage from 'expo-sqlite/kv-store';

// expo-sqlite's kv-store opens its database lazily, either synchronously
// (getItemSync) or asynchronously inside a transaction (getItem). When both
// happen at app start — the recording session reads synchronously while the
// settings and auth stores hydrate asynchronously — the two opens race and
// hydration fails with "execAsync has failed", silently dropping the user's
// settings. Opening it synchronously once, before anyone else, avoids that.
Storage.getItemSync('runner.kv.init');

export const kv = Storage;
