import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureNarrativeLab, getActiveEngine, startLabServer, securityGate } from "./lab";
import { NarrativeEngine } from "./engine";
import * as fs from "fs";
import express from "express";

vi.mock("fs", () => ({
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

vi.mock("node:http", () => ({
    default: {
        createServer: vi.fn(() => ({
            listen: vi.fn((port, host, cb) => {
                if (typeof cb === 'function') cb();
            }),
        })),
    },
    createServer: vi.fn(() => ({
        listen: vi.fn((port, host, cb) => {
            if (typeof cb === 'function') cb();
        }),
    })),
}));

vi.mock("express", () => {
    const mockJson = vi.fn();
    const mockStatic = vi.fn();
    const mockExpress = vi.fn(() => ({
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        listen: vi.fn((port, host, cb) => {
            if (typeof host === 'function') host();
            else if (typeof cb === 'function') cb();
        }),
    })) as any;
    mockExpress.json = () => mockJson;
    mockExpress.static = mockStatic;
    
    return { 
        default: mockExpress,
        json: () => mockJson,
        static: mockStatic,
    };
});

describe("NarrativeLab Registry & Server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear global symbol for clean tests
        const GLOBAL_KEY = Symbol.for("narrative.engine.registry");
        delete (global as any)[ GLOBAL_KEY ];
    });

    it("should provision a default engine if none is provided", () => {
        const engine = getActiveEngine();
        configureNarrativeLab(engine);
        expect(engine).toBeInstanceOf(NarrativeEngine);
    });

    it("should return a new engine even if configure was never called", () => {
        const engine = getActiveEngine();
        expect(engine).toBeInstanceOf(NarrativeEngine);
    });

    it("should update config via /__narrative_lab/generate", async () => {
        const engine = getActiveEngine();
        configureNarrativeLab(engine);
        const spy = vi.spyOn(engine, "setLabConfig");

        // Mocking the express req/res
        const req = { body: { channelId: "test", query: "hi", config: { weightDense: 0.1 } } };
        const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

        await startLabServer();
        const app = vi.mocked(express).mock.results[0].value;
        const handler = app.post.mock.calls.find((c: any) => c[ 0 ] === "/__narrative_lab/generate")[ 1 ];

        await handler(req, res);
        expect(spy).toHaveBeenCalledWith({ weightDense: 0.1 });
    });

    it("should handle missing trace files gracefully (ENOENT)", async () => {
        vi.mocked(fs.readFileSync).mockImplementation(() => {
            const err = new Error() as any;
            err.code = 'ENOENT';
            throw err;
        });

        await startLabServer();
        const app = vi.mocked(express).mock.results[0].value;
        const handler = app.get.mock.calls.find((c: any) => c[ 0 ] === "/__narrative_lab/traces")[ 1 ];

        const res = { json: vi.fn() };
        handler({}, res);
        expect(res.json).toHaveBeenCalledWith({ traces: [] });
    });
});

describe("NarrativeLab Security Gate", () => {
    it("should block requests with missing authorization", () => {
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const req = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };

        securityGate(req as any, res as any, () => { });

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it("should block non-local requests even with a valid token", () => {
        const SESSION_SECRET = (global as any)[ Symbol.for("narrative.lab.token") ];
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const req = {
            socket: { remoteAddress: "192.168.1.5" },
            headers: { authorization: `Bearer ${SESSION_SECRET}` }
        };

        securityGate(req as any, res as any, () => { });

        expect(res.status).toHaveBeenCalledWith(403);
    });

    it("should allow local requests with a valid token", () => {
        const SESSION_SECRET = (global as any)[ Symbol.for("narrative.lab.token") ];
        const next = vi.fn();
        const req = {
            socket: { remoteAddress: "127.0.0.1" },
            headers: { authorization: `Bearer ${SESSION_SECRET}` }
        };

        securityGate(req as any, {} as any, next);

        expect(next).toHaveBeenCalled();
    });
});
