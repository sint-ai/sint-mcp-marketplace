import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store registered handlers
const promptHandlers: Record<string, (params: any) => Promise<any>> = {};
const toolHandlers: Record<string, (params: any, extra: any) => Promise<any>> = {};
const resourceHandlers: Record<string, () => Promise<any>> = {};

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
    return {
        McpServer: class MockMcpServer {
            server = { onerror: null };
            constructor() {}
            prompt(name: string, _description: string, _schema: any, handler: any) {
                promptHandlers[name] = handler;
            }
            tool(name: string, _description: string, _schema: any, handler: any) {
                toolHandlers[name] = handler;
            }
            resource(name: string, _uri: string, _options: any, handler: any) {
                resourceHandlers[name] = handler;
            }
            connect() { return Promise.resolve(); }
            close() {}
        },
    };
});

// Mock StreamableHTTPServerTransport
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
    return {
        StreamableHTTPServerTransport: class MockTransport {
            onerror = null;
            constructor() {}
            handleRequest() { return Promise.resolve(); }
            close() {}
        },
    };
});

// Mock fetch-to-node
vi.mock('fetch-to-node', () => ({
    toReqRes: vi.fn().mockReturnValue({
        req: {},
        res: { on: vi.fn() },
    }),
    toFetchResponse: vi.fn().mockReturnValue(new Response()),
}));

import app from './index.js';

describe('index.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear handlers
        Object.keys(promptHandlers).forEach((k) => delete promptHandlers[k]);
        Object.keys(toolHandlers).forEach((k) => delete toolHandlers[k]);
        Object.keys(resourceHandlers).forEach((k) => delete resourceHandlers[k]);
    });

    describe('Hono app', () => {
        it('should be a valid Hono instance', () => {
            expect(app).toBeDefined();
            expect(app.fetch).toBeDefined();
        });
    });

    describe('GET /mcp', () => {
        it('should return 405 Method Not Allowed', async () => {
            const res = await app.request('/mcp', { method: 'GET' });
            expect(res.status).toBe(405);
        });

        it('should return JSON-RPC error format', async () => {
            const res = await app.request('/mcp', { method: 'GET' });
            const body = await res.json();
            expect(body).toEqual({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Method not allowed.',
                },
                id: null,
            });
        });
    });

    describe('DELETE /mcp', () => {
        it('should return 405 Method Not Allowed', async () => {
            const res = await app.request('/mcp', { method: 'DELETE' });
            expect(res.status).toBe(405);
        });

        it('should return JSON-RPC error format', async () => {
            const res = await app.request('/mcp', { method: 'DELETE' });
            const body = await res.json();
            expect(body).toEqual({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Method not allowed.',
                },
                id: null,
            });
        });
    });

    describe('POST /mcp', () => {
        it('should handle valid MCP request', async () => {
            const res = await app.request('/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
            });
            // Should not return 500 error
            expect(res.status).not.toBe(500);
        });
    });

    describe('greeting-template prompt', () => {
        it('should generate greeting message', async () => {
            // Trigger module to register handlers
            await app.request('/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            const result = await promptHandlers['greeting-template']({ name: 'Alice' });

            expect(result.messages).toHaveLength(1);
            expect(result.messages[0].role).toBe('user');
            expect(result.messages[0].content.text).toContain('Alice');
        });
    });

    describe('start-notification-stream tool', () => {
        it('should send periodic notifications', async () => {
            // Trigger module to register handlers
            await app.request('/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            const mockSendNotification = vi.fn().mockResolvedValue(undefined);

            const result = await toolHandlers['start-notification-stream'](
                { interval: 10, count: 3 },
                { sendNotification: mockSendNotification }
            );

            expect(mockSendNotification).toHaveBeenCalledTimes(3);
            expect(result.content[0].text).toContain('Started sending periodic notifications');
        });

        it('should respect count parameter', async () => {
            await app.request('/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            const mockSendNotification = vi.fn().mockResolvedValue(undefined);

            await toolHandlers['start-notification-stream'](
                { interval: 1, count: 5 },
                { sendNotification: mockSendNotification }
            );

            expect(mockSendNotification).toHaveBeenCalledTimes(5);
        });

        it('should handle notification errors gracefully', async () => {
            await app.request('/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            const mockSendNotification = vi.fn().mockRejectedValue(new Error('Network error'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await toolHandlers['start-notification-stream'](
                { interval: 1, count: 2 },
                { sendNotification: mockSendNotification }
            );

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('greeting-resource resource', () => {
        it('should return greeting content', async () => {
            await app.request('/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            const result = await resourceHandlers['greeting-resource']();

            expect(result.contents).toHaveLength(1);
            expect(result.contents[0].uri).toBe('https://example.com/greetings/default');
            expect(result.contents[0].text).toBe('Hello, world!');
        });
    });
});
