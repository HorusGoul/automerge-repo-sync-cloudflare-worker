import { DurableObject } from 'cloudflare:workers';
import { Repo } from '@automerge/automerge-repo';
import { R2StorageAdapter } from './R2StorageAdapter';
import { CloudflareWebSocketAdapter } from './CloudflareWebSocketAdapter';

interface Env {
	REPO_SYNC_BUCKET: R2Bucket;
	SYNC_SERVER: DurableObjectNamespace<SyncServer>;
}

/**
 * SyncServer is a Durable Object that manages an Automerge Repo instance
 * and handles WebSocket connections for real-time synchronization.
 *
 * Each Durable Object instance manages a single Repo, which can handle
 * multiple WebSocket connections.
 */
export class SyncServer extends DurableObject<Env> {
	private repo: Repo | null = null;
	private adapter: CloudflareWebSocketAdapter | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * Initialize the Repo with R2 storage adapter and CloudflareWebSocketAdapter
	 */
	private initializeRepo(): Repo {
		if (this.repo) {
			return this.repo;
		}

		const storageAdapter = new R2StorageAdapter(this.env.REPO_SYNC_BUCKET);

		// Create the WebSocket adapter
		this.adapter = new CloudflareWebSocketAdapter();

		this.repo = new Repo({
			storage: storageAdapter,
			network: [this.adapter],
			sharePolicy: async () => false,
		});

		return this.repo;
	}

	/**
	 * Handle HTTP requests and WebSocket upgrades
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Check if this is a WebSocket upgrade request
		if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket' || url.searchParams.get('ws') !== null) {
			return this.handleWebSocket(request);
		}

		// Handle regular HTTP requests
		return new Response('Automerge Repo Sync Server', {
			status: 200,
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	}

	/**
	 * Handle WebSocket connection for real-time synchronization
	 */
	private async handleWebSocket(request: Request): Promise<Response> {
		// Create a WebSocket pair
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Accept the server-side WebSocket connection
		this.ctx.acceptWebSocket(server);

		// Initialize the repo and adapter if needed
		const repo = this.initializeRepo();
		if (!this.adapter) {
			throw new Error('Adapter not initialized');
		}

		// Add this WebSocket connection to the adapter
		this.adapter.addConnection(server);

		// Return the client-side WebSocket
		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	/**
	 * Handle WebSocket messages
	 */
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (this.adapter) {
			this.adapter.handleMessage(ws, message);
		}
	}

	/**
	 * Handle WebSocket close events
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		// Remove the connection from the adapter
		if (this.adapter) {
			this.adapter.removeConnection(ws);
		}
		ws.close(code, reason);
	}

	/**
	 * Handle WebSocket errors
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error('WebSocket error in SyncServer:', error);
	}
}
