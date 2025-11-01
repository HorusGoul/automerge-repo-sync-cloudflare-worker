import { NetworkAdapter, cbor } from '@automerge/automerge-repo';
import type { Message, PeerId, PeerMetadata } from '@automerge/automerge-repo';

interface WebSocketConnection {
	ws: WebSocket;
	peerId: PeerId | null;
	peerMetadata: PeerMetadata | undefined;
}

/**
 * JoinMessage is sent by clients when they connect
 */
interface JoinMessage {
	type: 'join';
	senderId: PeerId;
	peerMetadata?: PeerMetadata;
	supportedProtocolVersions: string[];
}

/**
 * PeerMessage is sent by server in response to join
 */
interface PeerMessage {
	type: 'peer';
	senderId: PeerId;
	peerMetadata?: PeerMetadata;
	targetId: PeerId;
	selectedProtocolVersion: string;
}

/**
 * CloudflareWebSocketAdapter is a NetworkAdapter implementation for Cloudflare Workers.
 *
 * It handles WebSocket connections using Cloudflare's WebSocket API and implements
 * the Automerge Repo WebSocket protocol (protocol version 1).
 */
export class CloudflareWebSocketAdapter extends NetworkAdapter {
	private connections: Map<WebSocket, WebSocketConnection> = new Map();
	private isConnected: boolean = false;

	constructor() {
		super();
	}

	/**
	 * Add a new WebSocket connection to this adapter
	 */
	addConnection(ws: WebSocket): void {
		this.connections.set(ws, {
			ws,
			peerId: null,
			peerMetadata: undefined,
		});
	}

	/**
	 * Remove a WebSocket connection
	 */
	removeConnection(ws: WebSocket): void {
		this.connections.delete(ws);
		if (this.connections.size === 0) {
			this.isConnected = false;
		}
	}

	/**
	 * Handle incoming WebSocket message
	 */
	handleMessage(ws: WebSocket, message: string | ArrayBuffer): void {
		const connection = this.connections.get(ws);
		if (!connection) return;

		try {
			// Convert message to Uint8Array
			let buffer: Uint8Array;
			if (typeof message === 'string') {
				buffer = new Uint8Array(new TextEncoder().encode(message));
			} else {
				buffer = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
			}

			// Decode CBOR message
			const decoded = cbor.decode(buffer) as JoinMessage | Message;

			// Handle join message (client announcing itself)
			if (decoded.type === 'join') {
				const joinMsg = decoded as JoinMessage;
				connection.peerId = joinMsg.senderId;
				connection.peerMetadata = joinMsg.peerMetadata;

				// Send peer message back
				if (this.peerId) {
					const peerMessage: PeerMessage = {
						type: 'peer',
						senderId: this.peerId,
						peerMetadata: this.peerMetadata,
						targetId: joinMsg.senderId,
						selectedProtocolVersion: '1',
					};
					const encoded = cbor.encode(peerMessage);
					ws.send(encoded);
				}

				// Emit peer candidate event
				this.emit('peer-candidate', {
					peerId: joinMsg.senderId,
					peerMetadata: joinMsg.peerMetadata || {},
				});
			} else {
				// Forward automerge message to Repo
				// The message event expects just the Message, not wrapped
				// But we need to emit through the network subsystem properly
				// For now, emit the message directly - the Repo will handle routing
				this.emit('message', decoded as Message);
			}
		} catch (error) {
			console.error('Error handling WebSocket message:', error);
		}

		// Mark as connected if we have at least one connection and peerId is set
		// The NetworkAdapter base class handles ready state internally
		if (!this.isConnected && this.peerId && this.connections.size > 0) {
			this.isConnected = true;
			// Emit open event instead of ready (following NetworkAdapter pattern)
		}
	}

	/**
	 * Called by the Repo to start the connection process
	 */
	connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
		this.peerId = peerId;
		this.peerMetadata = peerMetadata;

		// Mark as ready if we have connections
		if (this.connections.size > 0) {
			this.isConnected = true;
		}
	}

	/**
	 * Called by the Repo to send a message to a peer
	 */
	send(message: Message): void {
		// Find the target peer's WebSocket from the message
		// Automerge messages have a targetId or we broadcast to all
		const targetId = (message as any).targetId;

		if (targetId) {
			// Send to specific peer
			for (const [ws, connection] of this.connections) {
				if (connection.peerId === targetId && ws.readyState === WebSocket.READY_STATE_OPEN) {
					const encoded = cbor.encode(message);

					ws.send(encoded);
					return;
				}
			}
		} else {
			// Broadcast to all connected peers
			const encoded = cbor.encode(message);
			for (const [ws, connection] of this.connections) {
				if (connection.peerId && ws.readyState === WebSocket.READY_STATE_OPEN) {
					ws.send(encoded);
				}
			}
		}
	}

	/**
	 * Called by the Repo to disconnect from the network
	 */
	disconnect(): void {
		// Close all WebSocket connections
		for (const [ws] of this.connections) {
			if (ws.readyState === WebSocket.READY_STATE_OPEN) {
				ws.close();
			}
		}
		this.connections.clear();
		this.isConnected = false;
		this.emit('close');
	}

	/**
	 * Check if the adapter is ready
	 */
	isReady(): boolean {
		return this.isConnected && this.peerId !== undefined;
	}

	/**
	 * Wait until the adapter is ready
	 */
	async whenReady(): Promise<void> {
		if (this.isReady()) {
			return Promise.resolve();
		}

		// Poll until ready (since there's no ready event in NetworkAdapterEvents)
		return new Promise((resolve) => {
			const checkInterval = setInterval(() => {
				if (this.isReady()) {
					clearInterval(checkInterval);
					resolve();
				}
			}, 10);
		});
	}
}
