import { SyncServer as SyncServerImpl } from './SyncServer';

export const SyncServer = SyncServerImpl;

/**
 * Main Cloudflare Worker entry point for Automerge Repo Sync Server.
 *
 * This worker routes requests to SyncServer Durable Objects which handle
 * WebSocket connections and synchronization for Automerge repositories.
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const server = env.SYNC_SERVER.getByName('default');

		// Forward the request to the Durable Object
		return server.fetch(request);
	},
} satisfies ExportedHandler<Env>;
