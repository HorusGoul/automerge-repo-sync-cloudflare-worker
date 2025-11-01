import { StorageAdapterInterface, type StorageKey, type Chunk } from '@automerge/automerge-repo';

/**
 * R2StorageAdapter implements the StorageAdapter interface for Cloudflare R2.
 *
 * Storage keys are arrays of strings like [documentId, "snapshot", hash] or
 * [documentId, "incremental", hash]. We convert these to R2 object keys by
 * joining the array with "/".
 */
export class R2StorageAdapter implements StorageAdapterInterface {
	constructor(private bucket: R2Bucket) {}

	/**
	 * Convert a StorageKey (array of strings) to an R2 object key
	 */
	private keyToString(key: StorageKey): string {
		return key.join('/');
	}

	/**
	 * Convert an R2 object key back to a StorageKey (array of strings)
	 */
	private stringToKey(key: string): StorageKey {
		return key.split('/');
	}

	/**
	 * Load a single value from R2 by key
	 */
	async load(key: StorageKey): Promise<Uint8Array | undefined> {
		const objectKey = this.keyToString(key);
		const object = await this.bucket.get(objectKey);
		if (!object) {
			return undefined;
		}
		const arrayBuffer = await object.arrayBuffer();
		return new Uint8Array(arrayBuffer);
	}

	/**
	 * Save a value to R2 with the given key
	 */
	async save(key: StorageKey, data: Uint8Array): Promise<void> {
		const objectKey = this.keyToString(key);
		await this.bucket.put(objectKey, data);
	}

	/**
	 * Remove a value from R2 by key
	 */
	async remove(key: StorageKey): Promise<void> {
		const objectKey = this.keyToString(key);
		await this.bucket.delete(objectKey);
	}

	/**
	 * Load all values with keys that start with the given prefix
	 */
	async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
		const prefix = this.keyToString(keyPrefix);
		const chunks: Chunk[] = [];

		const listOptions: R2ListOptions = {
			prefix: prefix + (prefix.endsWith('/') ? '' : '/'),
		};

		const objects = await this.bucket.list(listOptions);

		for (const object of objects.objects) {
			const key = this.stringToKey(object.key);
			const data = await this.load(key);
			chunks.push({
				key,
				data,
			});
		}

		return chunks;
	}

	/**
	 * Remove all values with keys that start with the given prefix
	 */
	async removeRange(keyPrefix: StorageKey): Promise<void> {
		const prefix = this.keyToString(keyPrefix);
		const listOptions: R2ListOptions = {
			prefix: prefix + (prefix.endsWith('/') ? '' : '/'),
		};

		const objects = await this.bucket.list(listOptions);

		// Delete all objects matching the prefix
		for (const object of objects.objects) {
			await this.bucket.delete(object.key);
		}
	}
}
